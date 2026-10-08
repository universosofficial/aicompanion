import chatService from '../services/chat.service.js';
import aiOrchestrator from '../services/ai/ai.orchestrator.js';

export class ChatController {
  /**
   * POST /api/chat/conversations
   * Initialize or retrieve conversation for character
   */
  async startConversation(req, res, next) {
    try {
      const { characterId } = req.body;
      if (!characterId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_CHARACTER_ID',
            message: 'characterId is required.',
          },
        });
      }

      const result = await chatService.getOrCreateConversation(req.user.id, characterId);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/chat/conversations/:id/messages
   * Fetch recent message history
   */
  async getMessages(req, res, next) {
    try {
      const conversationId = req.params.id;
      const limit = parseInt(req.query.limit, 10) || 50;
      const messages = await chatService.getMessages(conversationId, req.user.id, limit);

      return res.status(200).json({
        success: true,
        data: messages,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/chat/message
   * Non-streaming turn (backwards compatible)
   */
  async sendMessage(req, res, next) {
    try {
      const { characterId, conversationId, content } = req.body;

      if (!characterId || !content) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'characterId and content are required.',
          },
        });
      }

      const result = await chatService.sendMessage({
        userId: req.user.id,
        characterId,
        conversationId,
        content,
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
   * POST /api/chat/stream
   * Real-Time Server-Sent Events (SSE) streaming endpoint
   */
  async streamMessage(req, res, next) {
    const { characterId, conversationId, content } = req.body;

    if (!characterId || !content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'characterId and content are required.',
        },
      });
    }

    // Set Server-Sent Events headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const abortController = new AbortController();

    // 5-minute guard timeout for long-lived SSE connections
    if (req.socket) {
      req.socket.setTimeout(300000);
      req.socket.setNoDelay(true);
      req.socket.setKeepAlive(true);
    }

    // Keep-alive heartbeat comment every 15s prevents proxy/Cloudflare drops
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':\n\n');
      }
    }, 15000);

    // Client disconnect handler: abort AI stream immediately
    res.on('close', () => {
      clearInterval(heartbeatTimer);
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      await aiOrchestrator.streamChatTurn({
        userId: req.user.id,
        characterId,
        conversationId,
        content: content.trim(),
        signal: abortController.signal,
        onChunk: (chunk) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        },
        onDone: (result) => {
          clearInterval(heartbeatTimer);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
            res.end();
          }
        },
      });
    } catch (error) {
      clearInterval(heartbeatTimer);
      if (abortController.signal.aborted || error.name === 'AbortError' || error.message?.includes('aborted')) {
        console.log('[STREAM CONTROLLER] Client disconnected or stream aborted.');
        if (!res.writableEnded) {
          res.end();
        }
        return;
      }
      console.error('[STREAM CONTROLLER ERROR]', error.message);
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({ error: { message: error.message || 'Stream processing failed.' } })}\n\n`
        );
        res.end();
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}

export const chatController = new ChatController();
export default chatController;
