import characterRepository from '../repositories/character.repository.js';
import mindRepository from '../repositories/mind.repository.js';
import sourceRepository from '../repositories/source.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import messageRepository from '../repositories/message.repository.js';
import knowledgeService from '../services/ingestion/knowledge.service.js';
import memoryService from '../services/ai/memory.service.js';
import { buildPublicMindSystemPrompt } from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';

/**
 * MindController
 * Public discovery, Knowledge Ingestion, Subscription Network, and Grounded Consultation.
 */
export class MindController {
  /**
   * GET /api/minds/explore
   * Discover and search published AI minds in the Thought Commons.
   */
  async exploreMinds(req, res, next) {
    try {
      const { query, tag, sort, page, limit } = req.query;
      const userId = req.user?.id || null;

      const result = await mindRepository.searchMinds({
        query: query ? String(query) : '',
        tag: tag ? String(tag) : '',
        sort: sort || 'popular',
        page: parseInt(page, 10) || 1,
        limit: Math.min(50, parseInt(limit, 10) || 20),
        userId,
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
   * Retrieve public profile, published doctrine, and sources for an AI Mind.
   */
  async getMindByHandle(req, res, next) {
    try {
      const { handle } = req.params;
      const userId = req.user?.id || null;
      const mind = await mindRepository.findByHandle(handle, userId);

      if (!mind) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'MIND_NOT_FOUND',
            message: `Public AI Mind @${handle.replace(/^@/, '')} not found.`,
          },
        });
      }

      // Fetch verified public sources
      const sources = await sourceRepository.findByCharacterId(mind.id);
      const safeSources = (sources || []).map((s) => ({
        id: s.id,
        title: s.title,
        sourceType: s.source_type,
        status: s.status,
        chunkCount: s.chunk_count,
        sourceUri: s.source_uri,
        createdAt: s.created_at,
      }));

      return res.status(200).json({
        success: true,
        data: {
          ...mind,
          sources: safeSources,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/:id/subscribe
   * Add this mind to current user's active companion list.
   */
  async subscribeMind(req, res, next) {
    try {
      const userId = req.user.id;
      const characterId = parseInt(req.params.id, 10);

      const character = await characterRepository.findById(characterId);
      if (!character || !character.is_public) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'MIND_NOT_FOUND',
            message: 'Public AI Mind not found or not published.',
          },
        });
      }

      await mindRepository.subscribeUser(userId, characterId);

      return res.status(200).json({
        success: true,
        message: `Added ${character.name} to your companions.`,
        is_subscribed: true,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/minds/:id/subscribe
   * Remove this mind from current user's active companion list.
   */
  async unsubscribeMind(req, res, next) {
    try {
      const userId = req.user.id;
      const characterId = parseInt(req.params.id, 10);

      await mindRepository.unsubscribeUser(userId, characterId);

      return res.status(200).json({
        success: true,
        message: 'Mind removed from your companions.',
        is_subscribed: false,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/minds/subscriptions
   * Get all public minds added to the current user's companions.
   */
  async getSubscribedMinds(req, res, next) {
    try {
      const userId = req.user.id;
      const minds = await mindRepository.getSubscriptionsByUserId(userId);
      return res.status(200).json({
        success: true,
        data: minds,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/:id/sources/url
   * Creator links a blog post or website article for ingestion.
   */
  async ingestUrlSource(req, res, next) {
    try {
      const characterId = parseInt(req.params.id, 10);
      const { url, title, topic } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_URL', message: 'Valid url string is required in request body.' },
        });
      }

      const character = await characterRepository.findById(characterId);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      if (character.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the creator may add knowledge sources to this Mind.' },
        });
      }

      const result = await knowledgeService.ingestUrl(characterId, url.trim(), { title, topic });

      return res.status(201).json({
        success: true,
        message: `Successfully ingested URL. Extracted ${result.chunksCreated} knowledge chunks.`,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/:id/sources/file (or upload)
   * Creator uploads a PDF, text, or markdown document for ingestion.
   */
  async ingestDocumentSource(req, res, next) {
    try {
      const characterId = parseInt(req.params.id, 10);

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FILE', message: 'A document file (.pdf, .txt, .md) is required.' },
        });
      }

      const character = await characterRepository.findById(characterId);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      if (character.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the creator may upload knowledge sources to this Mind.' },
        });
      }

      const { title, topic } = req.body;
      const result = await knowledgeService.ingestDocument(
        characterId,
        req.file.buffer,
        req.file.originalname,
        { title, topic }
      );

      return res.status(201).json({
        success: true,
        message: `Successfully indexed ${req.file.originalname}. Created ${result.chunksCreated} knowledge chunks.`,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/:id/sources/text
   * Creator adds direct manual text doctrine / rules.
   */
  async ingestManualTextSource(req, res, next) {
    try {
      const characterId = parseInt(req.params.id, 10);
      const { title, content, topic } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_CONTENT', message: 'Text content is required for doctrine ingestion.' },
        });
      }

      const character = await characterRepository.findById(characterId);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      if (character.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the creator may add knowledge sources to this Mind.' },
        });
      }

      const result = await knowledgeService.ingestManualText(characterId, { title, content, topic });

      return res.status(201).json({
        success: true,
        message: `Successfully ingested text doctrine. Created ${result.chunksCreated} knowledge chunks.`,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/minds/:id/sources
   * Creator views status of uploaded materials.
   */
  async getSources(req, res, next) {
    try {
      const characterId = parseInt(req.params.id, 10);
      const character = await characterRepository.findById(characterId);

      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      const isOwner = req.user && req.user.id === character.user_id;
      if (!isOwner && !character.is_public) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied.' },
        });
      }

      const sources = await sourceRepository.findByCharacterId(characterId);

      return res.status(200).json({
        success: true,
        data: sources,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/minds/:id/sources/:sourceId
   * Creator deletes an ingested source and associated chunks.
   */
  async deleteSource(req, res, next) {
    try {
      const characterId = parseInt(req.params.id, 10);
      const sourceId = parseInt(req.params.sourceId, 10);

      const character = await characterRepository.findById(characterId);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      if (character.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the creator may delete sources from this Mind.' },
        });
      }

      const deleted = await sourceRepository.deleteSource(sourceId);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: { code: 'SOURCE_NOT_FOUND', message: 'Source not found.' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Source and associated knowledge chunks deleted successfully.',
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/:id/publish
   * Creator publishes their AI companion to the Mind Commons and claims a handle.
   */
  async publishMind(req, res, next) {
    try {
      const characterId = parseInt(req.params.id, 10);
      const {
        is_public,
        handle,
        headline,
        website_url,
        philosophy_statement,
        decision_frameworks,
        mental_models,
        tags,
      } = req.body;

      const character = await characterRepository.findById(characterId);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      if (character.user_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only the creator may publish this Mind.' },
        });
      }

      const updates = {};

      if (is_public !== undefined) {
        updates.is_public = Boolean(is_public);
      }

      if (handle !== undefined) {
        const cleanHandle = String(handle).replace(/^@/, '').toLowerCase().trim();
        if (cleanHandle.length > 0) {
          if (!/^[a-z0-9_]{3,30}$/.test(cleanHandle)) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'INVALID_HANDLE',
                message: 'Handle must be between 3 and 30 characters using only letters, numbers, and underscores.',
              },
            });
          }

          const available = await mindRepository.isHandleAvailable(cleanHandle, characterId);
          if (!available) {
            return res.status(409).json({
              success: false,
              error: {
                code: 'HANDLE_TAKEN',
                message: `@${cleanHandle} is already claimed by another AI Mind.`,
              },
            });
          }

          updates.handle = cleanHandle;
        } else {
          updates.handle = null;
        }
      }

      if (headline !== undefined) updates.headline = String(headline).trim().slice(0, 255);
      if (website_url !== undefined) updates.website_url = website_url ? String(website_url).trim().slice(0, 512) : null;
      if (philosophy_statement !== undefined) updates.philosophy_statement = String(philosophy_statement).trim();
      if (decision_frameworks !== undefined) updates.decision_frameworks = decision_frameworks;
      if (mental_models !== undefined) updates.mental_models = mental_models;
      if (tags !== undefined) updates.tags = tags;

      const updated = await characterRepository.update(characterId, req.user.id, updates);

      return res.status(200).json({
        success: true,
        message: updates.is_public
          ? `AI Mind @${updated.handle || updated.name} is now published to the Mind Commons.`
          : 'AI Mind has been made private.',
        data: updated,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/minds/:id/consult or POST /api/minds/@:handle/consult
   * Start or continue an isolated, private consulting conversation with a public mind over SSE.
   */
  async consultMind(req, res, next) {
    try {
      const { id, handle } = req.params;
      const { message, conversationId, streaming = true } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_MESSAGE', message: 'Message text is required for consultation.' },
        });
      }

      let mind;
      if (handle) {
        mind = await mindRepository.findByHandle(handle);
      } else {
        mind = await characterRepository.findById(parseInt(id, 10));
      }

      if (!mind || (!mind.is_public && mind.user_id !== req.user?.id)) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: 'Public AI Mind not found or is not currently open for public consultation.' },
        });
      }

      // 1. Retrieve top matching knowledge nodes for grounding (~5 chunks)
      const retrievedChunks = await mindRepository.findRelevantKnowledge(mind.id, message.trim(), 5);

      // 2. Isolated consultation session
      const userId = req.user?.id || null;
      let activeConversation = null;
      let recentTurns = [];
      let userMemories = [];

      if (userId) {
        // Authenticated consultation: keep conversation completely private to that user
        if (conversationId) {
          activeConversation = await conversationRepository.findById(conversationId, userId);
        }

        if (!activeConversation) {
          activeConversation = await conversationRepository.create({
            userId,
            characterId: mind.id,
            title: `Consultation with ${mind.name}`,
          });
        }

        recentTurns = await messageRepository.findRecentByConversationId(activeConversation.id, 8);
        userMemories = await memoryService.getMemoriesForPrompt({ userId, characterId: mind.id, limit: 5 });

        // Save incoming user message
        await messageRepository.create({
          conversationId: activeConversation.id,
          senderType: 'user',
          content: message.trim(),
          tokenCount: Math.ceil(message.length / 4),
        });
      }

      // 3. Build grounded prompt embodying mind doctrine, source excerpts, and user context
      const systemPrompt = buildPublicMindSystemPrompt(mind, retrievedChunks, userMemories);

      // Assemble chat payload for OpenAI
      const openAiMessages = [
        { role: 'system', content: systemPrompt },
        ...recentTurns.map((m) => ({
          role: m.sender_type === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        { role: 'user', content: message.trim() },
      ];

      // Prepare SSE streaming headers
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

      // Emit grounded knowledge telemetry event first so frontend can display indicator immediately
      res.write(
        `event: grounded\ndata: ${JSON.stringify({
          mind: { id: mind.id, name: mind.name, handle: mind.handle, is_verified: mind.is_verified },
          groundedChunksCount: retrievedChunks.length,
          groundedSources: retrievedChunks.map((c) => ({
            id: c.id,
            title: c.title,
            topic: c.topic,
          })),
        })}\n\n`
      );

      // Stream generation from OpenAI
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

      // Persist assistant message if authenticated
      let savedAssistantMessage = null;
      if (userId && activeConversation) {
        savedAssistantMessage = await messageRepository.create({
          conversationId: activeConversation.id,
          senderType: 'assistant',
          content: fullResponse,
          tokenCount: Math.ceil(fullResponse.length / 4),
        });
        await conversationRepository.updateLastMessageAt(activeConversation.id);
      }

      // Increment mind consultation stats & record session
      mindRepository.incrementInteractions(mind.id).catch((err) =>
        console.error('[MIND_CONSULT] Error incrementing interactions:', err.message)
      );

      if (userId) {
        mindRepository.recordVisitorSession(userId, mind.id).catch((err) =>
          console.error('[MIND_CONSULT] Error recording visitor session:', err.message)
        );

        if (activeConversation) {
          memoryService.extractAndSaveMemoriesAsync({
            userId,
            characterId: mind.id,
            characterName: mind.name,
            recentTurns: [
              ...recentTurns,
              { sender_type: 'user', content: message.trim() },
              { sender_type: 'assistant', content: fullResponse },
            ],
            conversationId: activeConversation.id,
            conversationTimestamp: new Date(),
          }).catch((err) => console.error('[MIND_CONSULT_MEMORY] Error extracting memories:', err.message));
        }
      }

      // Emit completion event
      res.write(
        `event: done\ndata: ${JSON.stringify({
          conversationId: activeConversation?.id || null,
          messageId: savedAssistantMessage?.id || null,
          fullResponse,
          groundedChunksCount: retrievedChunks.length,
          groundedSources: retrievedChunks.map((c) => ({
            id: c.id,
            title: c.title,
            topic: c.topic,
          })),
        })}\n\n`
      );

      return res.end();
    } catch (err) {
      if (!res.headersSent) {
        return next(err);
      }
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      return res.end();
    }
  }

  // Alias for backward compatibility with streamConsultation
  async streamConsultation(req, res, next) {
    return this.consultMind(req, res, next);
  }
}

export const mindController = new MindController();
export default mindController;
