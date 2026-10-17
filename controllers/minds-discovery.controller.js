import userMindRepository from '../repositories/user-mind.repository.js';
import mindKnowledgeRepository from '../repositories/mind-knowledge.repository.js';
import memoryService from '../services/ai/memory.service.js';
import { buildMindConsultationPrompt } from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';

/**
 * MindsDiscoveryController
 * Handles public registry search, public profile display, and Socratic consultation sessions.
 */
export class MindsDiscoveryController {
  /**
   * GET /api/minds/explore
   * Search and filter published AI Minds in the Thought Commons.
   */
  async exploreMinds(req, res, next) {
    try {
      const { query, tag, page, limit } = req.query;

      const result = await userMindRepository.searchMinds({
        query: query ? String(query) : '',
        tag: tag ? String(tag) : '',
        page: parseInt(page, 10) || 1,
        limit: Math.min(50, parseInt(limit, 10) || 20),
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/minds/@:handle
   * Public profile view of a published AI Mind.
   */
  async getMindByHandle(req, res, next) {
    try {
      const handle = req.params.handle.replace(/^@/, '').trim();
      const mind = await userMindRepository.findByHandle(handle);

      if (!mind || !mind.is_published) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: `Public AI Mind @${handle} was not found or is currently private.` },
        });
      }

      const sources = await mindKnowledgeRepository.findSourcesByMindId(mind.id);
      const publicSources = sources
        .filter((s) => s.status === 'indexed')
        .map((s) => ({
          id: s.id,
          title: s.title,
          source_type: s.source_type,
          chunk_count: s.chunk_count,
        }));

      let consultationMessages = [];
      let sessionMeta = null;
      if (req.user?.id) {
        const session = await mindKnowledgeRepository.findOrCreateConsultationSession(
          req.user.id,
          mind.id,
          `Consultation with ${mind.display_name}`
        );
        consultationMessages = await mindKnowledgeRepository.findRecentConsultationMessages(session.id, 50);
        sessionMeta = {
          id: session.id,
          chat_mode: session.chat_mode || 'ai',
          is_paid_unlocked: Boolean(session.is_paid_unlocked),
          paid_amount: Number(session.paid_amount || mind.direct_chat_price || 25),
          handoff_summary: session.handoff_summary || null,
          escalation_note: session.escalation_note || null,
          escalated_at: session.escalated_at || null,
        };
      }

      return res.status(200).json({
        success: true,
        data: {
          ...mind,
          sources: publicSources,
          messages: consultationMessages,
          session: sessionMeta,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/@:handle/consult (or POST /api/minds/:id/consult)
   * Real-time SSE streaming consultation grounded in the Mind's writings and Socratic mentorship.
   */
  async consultMind(req, res, next) {
    try {
      const { handle, id } = req.params;
      const { message, sessionId, history, forceAi } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_MESSAGE', message: 'Message text is required for consultation.' },
        });
      }

      let mind;
      if (handle) {
        mind = await userMindRepository.findByHandle(handle);
      } else if (id) {
        mind = await userMindRepository.findById(id);
      }

      if (!mind || (!mind.is_published && mind.user_id !== req.user?.id)) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: 'Public AI Mind not found or is currently private.' },
        });
      }

      // 1. Retrieve top matching knowledge chunks (~5 nodes)
      const retrievedChunks = await mindKnowledgeRepository.findRelevantKnowledge(mind.id, message.trim(), 5);

      // 2. Setup isolated consultation session
      const visitorUserId = req.user?.id || null;
      let activeSession = null;
      let recentTurns = [];
      let visitorMemories = [];

      if (visitorUserId) {
        activeSession = await mindKnowledgeRepository.findOrCreateConsultationSession(
          visitorUserId,
          mind.id,
          `Consultation with ${mind.display_name}`
        );

        recentTurns = await mindKnowledgeRepository.findRecentConsultationMessages(activeSession.id, 8);
        visitorMemories = await memoryService.getMemoriesForPrompt({
          userId: visitorUserId,
          characterId: null,
          limit: 5,
        });

        // Record incoming user message
        await mindKnowledgeRepository.createConsultationMessage(activeSession.id, 'user', message.trim());

        // If session is currently in Direct Human mode, deliver straight to the real creator's VIP Inbox without AI auto-reply
        if (activeSession.chat_mode === 'human_direct' && !forceAi) {
          await mindKnowledgeRepository.incrementUnreadForCreator(activeSession.id);
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();
          res.write(
            `event: done\ndata: ${JSON.stringify({
              sessionId: activeSession.id,
              humanDirectQueued: true,
              chatMode: 'human_direct',
              fullResponse: '',
              groundedChunksCount: 0,
              groundedSources: [],
            })}\n\n`
          );
          res.end();
          return;
        }
      } else if (Array.isArray(history) && history.length > 0) {
        recentTurns = history.slice(-8).map((m) => ({
          sender_type: m.sender_type === 'mind' || m.sender_type === 'creator' ? 'mind' : 'user',
          content: m.content,
        }));
      }

      // 3. Assemble Socratic grounded prompt
      const systemPrompt = buildMindConsultationPrompt(mind, retrievedChunks, visitorMemories);

      const openAiMessages = [
        { role: 'system', content: systemPrompt },
        ...recentTurns
          .filter((m) => m.sender_type !== 'system')
          .map((m) => ({
            role: m.sender_type === 'mind' || m.sender_type === 'creator' ? 'assistant' : 'user',
            content: m.content,
          })),
        { role: 'user', content: message.trim() },
      ];

      // 4. Stream response over SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const abortController = new AbortController();

      if (req.socket) {
        req.socket.setTimeout(300000);
        req.socket.setNoDelay(true);
        req.socket.setKeepAlive(true);
      }

      const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
          res.write(':\n\n');
        }
      }, 15000);

      res.on('close', () => {
        clearInterval(heartbeatTimer);
        if (!res.writableEnded) {
          abortController.abort();
        }
      });

      // Emit grounding telemetry
      res.write(
        `event: grounded\ndata: ${JSON.stringify({
          mind: { id: mind.id, display_name: mind.display_name, handle: mind.handle },
          groundedChunksCount: retrievedChunks.length,
          groundedSources: retrievedChunks.map((c) => ({
            id: c.id,
            title: c.title || c.source_title,
            topic: c.topic,
            excerpt: c.content ? c.content.slice(0, 380) : '',
            source_type: c.source_type || 'document',
          })),
        })}\n\n`
      );

      const stream = await openAiService.createChatStream({
        messages: openAiMessages,
        signal: abortController.signal,
      });

      let fullResponse = '';

      for await (const token of stream) {
        if (res.writableEnded || abortController.signal.aborted) break;
        fullResponse += token;
        res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
      }

      clearInterval(heartbeatTimer);

      if (abortController.signal.aborted) {
        return;
      }

      // 5. Persist assistant reply if authenticated
      if (visitorUserId && activeSession) {
        await mindKnowledgeRepository.createConsultationMessage(activeSession.id, 'mind', fullResponse);
      }

      // 6. Increment consultations counter
      userMindRepository.incrementConsultations(mind.id).catch((err) =>
        console.error('[MIND_CONSULT] Error incrementing count:', err.message)
      );

      // 7. Background memory extraction
      if (visitorUserId && activeSession) {
        memoryService.extractAndSaveMemoriesAsync({
          userId: visitorUserId,
          characterId: null,
          characterName: mind.display_name,
          recentTurns: [
            ...recentTurns,
            { sender_type: 'user', content: message.trim() },
            { sender_type: 'assistant', content: fullResponse },
          ],
          conversationId: activeSession.id,
          conversationTimestamp: new Date(),
        }).catch((err) => console.error('[MIND_CONSULT_MEMORY] Error:', err.message));
      }

      // 8. Emit done event
      res.write(
        `event: done\ndata: ${JSON.stringify({
          sessionId: activeSession?.id || null,
          fullResponse,
          groundedChunksCount: retrievedChunks.length,
          groundedSources: retrievedChunks.map((c) => ({
            id: c.id,
            title: c.title || c.source_title,
            topic: c.topic,
            excerpt: c.content ? c.content.slice(0, 380) : '',
            source_type: c.source_type || 'document',
          })),
        })}\n\n`
      );
      res.end();
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        return;
      }
      if (!res.headersSent) {
        return next(err);
      }
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
  }

  /**
   * POST /api/minds/council
   * Boardroom / Council Mode: Consult 2-3 AI Minds simultaneously on a single dilemma.
   * Each Mind provides its grounded perspective and challenges the other Minds' blind spots.
   */
  async consultCouncil(req, res, next) {
    try {
      const { handles, question } = req.body;
      if (!question || !String(question).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_QUESTION', message: 'A question or dilemma is required for Council consultation.' },
        });
      }

      const handleList = Array.isArray(handles)
        ? handles.map((h) => String(h).replace(/^@/, '').trim()).filter(Boolean).slice(0, 3)
        : [];

      if (handleList.length < 2) {
        return res.status(400).json({
          success: false,
          error: { code: 'MIN_COUNCIL_MINDS', message: 'Select at least 2 AI Minds to convene a Council.' },
        });
      }

      const minds = [];
      for (const h of handleList) {
        const m = await userMindRepository.findByHandle(h);
        if (m) {
          const chunks = await mindKnowledgeRepository.findRelevantKnowledge(m.id, question.trim(), 3);
          minds.push({ mind: m, chunks });
        }
      }

      if (minds.length < 2) {
        return res.status(404).json({
          success: false,
          error: { code: 'MINDS_NOT_FOUND', message: 'Could not find the selected AI Minds.' },
        });
      }

      // Generate each Mind's grounded perspective in parallel
      const perspectives = await Promise.all(
        minds.map(async ({ mind, chunks }) => {
          const otherNames = minds
            .filter((x) => x.mind.id !== mind.id)
            .map((x) => x.mind.display_name || x.mind.handle)
            .join(' and ');

          const systemPrompt = `${buildMindConsultationPrompt(mind, chunks, [])}\n\nCOUNCIL MODE: You are in a Boardroom Council alongside ${otherNames}. Give your sharp, authentic perspective (3-4 sentences max) grounded in your philosophy and mental models, then add 1 sentence pointing out a potential blind spot in conventional thinking on this dilemma.`;

          const completion = await openAiService.generateChatCompletion({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: question.trim() },
            ],
            max_tokens: 260,
          });

          return {
            id: mind.id,
            handle: mind.handle,
            display_name: mind.display_name,
            headline: mind.headline,
            avatar_url: mind.avatar_url,
            perspective: completion.content,
            groundedSources: chunks.map((c) => ({
              id: c.id,
              title: c.title || c.source_title,
              topic: c.topic,
              excerpt: c.content ? c.content.slice(0, 320) : '',
            })),
          };
        })
      );

      // Generate unified Council Verdict
      const summaryPrompt = `You are the Boardroom Moderator synthesizing a Council debate on: "${question.trim()}".\n\nHere are the perspectives:\n${perspectives
        .map((p) => `- ${p.display_name} (@${p.handle}): ${p.perspective}`)
        .join('\n\n')}\n\nProvide a concise 3-bullet "Council Verdict & Action Plan":\n1. Where the Minds agree\n2. The key tension / trade-off to weigh\n3. Your recommended next step`;

      const synthesisCompletion = await openAiService.generateChatCompletion({
        messages: [{ role: 'user', content: summaryPrompt }],
        max_tokens: 240,
      });

      return res.status(200).json({
        success: true,
        data: {
          question: question.trim(),
          perspectives,
          verdict: synthesisCompletion.content,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/@:handle/escalate
   * Unlock Paid Direct Human Chat ($XX per session) inside the existing AI Mind conversation thread,
   * automatically generating an AI Context Handoff Brief for the real human creator.
   */
  async escalateToHuman(req, res, next) {
    try {
      const visitorUserId = req.user?.id;
      if (!visitorUserId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Please sign in to unlock direct human chat.' },
        });
      }

      const handle = (req.params.handle || '').replace(/^@/, '').trim();
      const mind = await userMindRepository.findByHandle(handle);

      if (!mind) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: `AI Mind @${handle} not found.` },
        });
      }

      const { escalationNote = '' } = req.body || {};
      const session = await mindKnowledgeRepository.findOrCreateConsultationSession(
        visitorUserId,
        mind.id,
        `Consultation with ${mind.display_name}`
      );

      const recentMsgs = await mindKnowledgeRepository.findRecentConsultationMessages(session.id, 14);
      const userTurns = recentMsgs.filter((m) => m.sender_type === 'user');

      let handoffSummary = '';
      if (userTurns.length > 0) {
        try {
          const transcript = recentMsgs
            .filter((m) => m.sender_type !== 'system')
            .map((m) => `${m.sender_type === 'user' ? 'Visitor' : mind.display_name + ' (AI)'}: ${m.content}`)
            .join('\n');

          const briefRes = await openAiService.generateChatCompletion({
            messages: [
              {
                role: 'system',
                content: `Summarize this visitor's AI Mind chat into a 2-3 sentence Context Handoff Brief for the real human (${mind.display_name}) who is taking over the chat. State: (1) what the visitor is building or trying to solve, (2) what was already covered with the AI Mind, and (3) what they need ${mind.display_name}'s personal eyes on now. Keep it ultra-concise (under 65 words) with no bullet lists.`,
              },
              {
                role: 'user',
                content: `${transcript}${escalationNote ? `\n\nVisitor's Escalation Note: "${escalationNote}"` : ''}`,
              },
            ],
            max_tokens: 160,
          });
          handoffSummary = (briefRes.content || '').trim();
        } catch (_) {}
      }

      if (!handoffSummary) {
        const lastUserText = userTurns.length > 0 ? userTurns[userTurns.length - 1].content : '';
        handoffSummary = escalationNote
          ? `Visitor escalated from AI Mind to discuss: "${escalationNote}".${lastUserText ? ` Previously explored: "${lastUserText.slice(0, 120)}".` : ''}`
          : lastUserText
            ? `Visitor was consulting your AI Mind on "${lastUserText.slice(0, 140)}" and unlocked direct 1-on-1 access for your personal guidance.`
            : `Visitor unlocked a direct 1-on-1 human session with ${mind.display_name}.`;
      }

      const price = Number(mind.direct_chat_price || 25);
      const updatedSession = await mindKnowledgeRepository.unlockDirectHumanChat(session.id, {
        paidAmount: price,
        handoffSummary,
        escalationNote: String(escalationNote || '').trim(),
      });

      // Add a clear in-thread handoff system divider
      await mindKnowledgeRepository.createConsultationMessage(
        session.id,
        'system',
        `✨ Direct Human Access Unlocked (${price} ◈ Vasos). Context brief handed over to ${mind.display_name} — you are now connected directly with the real person (${mind.direct_chat_sla || 'Replies personally within a few hours'}).`
      );

      // If the visitor typed a direct priority note for the real person, append it right into the thread
      if (escalationNote && String(escalationNote).trim().length > 0) {
        await mindKnowledgeRepository.createConsultationMessage(
          session.id,
          'user',
          String(escalationNote).trim()
        );
      }

      const allMessages = await mindKnowledgeRepository.findRecentConsultationMessages(session.id, 50);

      return res.status(200).json({
        success: true,
        message: `Direct Human Chat unlocked with ${mind.display_name}.`,
        data: {
          session: {
            id: updatedSession.id,
            chat_mode: updatedSession.chat_mode || 'human_direct',
            is_paid_unlocked: Boolean(updatedSession.is_paid_unlocked),
            paid_amount: Number(updatedSession.paid_amount || price),
            currency: 'VASO',
            token_symbol: '◈',
            handoff_summary: updatedSession.handoff_summary || handoffSummary,
            escalation_note: updatedSession.escalation_note || null,
            escalated_at: updatedSession.escalated_at || new Date().toISOString(),
          },
          messages: allMessages,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/@:handle/mode
   * Toggle between 'human_direct' (Real Person) and 'ai' (AI Digital Twin) once unlocked.
   */
  async switchChatMode(req, res, next) {
    try {
      const visitorUserId = req.user?.id;
      if (!visitorUserId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required.' },
        });
      }

      const handle = (req.params.handle || '').replace(/^@/, '').trim();
      const mind = await userMindRepository.findByHandle(handle);
      if (!mind) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: `AI Mind @${handle} not found.` },
        });
      }

      const { mode } = req.body || {};
      const session = await mindKnowledgeRepository.findOrCreateConsultationSession(
        visitorUserId,
        mind.id,
        `Consultation with ${mind.display_name}`
      );

      if (mode === 'human_direct' && !session.is_paid_unlocked) {
        return res.status(403).json({
          success: false,
          error: { code: 'PAYMENT_REQUIRED', message: 'Unlock Direct Human Access first to switch to the real person.' },
        });
      }

      const updated = await mindKnowledgeRepository.setSessionChatMode(session.id, mode);
      return res.status(200).json({
        success: true,
        data: {
          session: {
            id: updated.id,
            chat_mode: updated.chat_mode,
            is_paid_unlocked: Boolean(updated.is_paid_unlocked),
            paid_amount: Number(updated.paid_amount || mind.direct_chat_price || 25),
            handoff_summary: updated.handoff_summary || null,
            escalation_note: updated.escalation_note || null,
          },
        },
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const mindsDiscoveryController = new MindsDiscoveryController();
export default mindsDiscoveryController;
