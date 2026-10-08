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

      return res.status(200).json({
        success: true,
        data: {
          ...mind,
          sources: publicSources,
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
      const { message, sessionId, history } = req.body;

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
      } else if (Array.isArray(history) && history.length > 0) {
        recentTurns = history.slice(-8).map((m) => ({
          sender_type: m.sender_type === 'mind' ? 'mind' : 'user',
          content: m.content,
        }));
      }

      // 3. Assemble Socratic grounded prompt
      const systemPrompt = buildMindConsultationPrompt(mind, retrievedChunks, visitorMemories);

      const openAiMessages = [
        { role: 'system', content: systemPrompt },
        ...recentTurns.map((m) => ({
          role: m.sender_type === 'mind' ? 'assistant' : 'user',
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
}

export const mindsDiscoveryController = new MindsDiscoveryController();
export default mindsDiscoveryController;
