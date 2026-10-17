import chatService from '../services/chat.service.js';
import aiOrchestrator from '../services/ai/ai.orchestrator.js';
import falVoiceService from '../services/voice/fal-voice.service.js';
import ttsService from '../services/voice/tts.service.js';
import messageRepository from '../repositories/message.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import characterRepository from '../repositories/character.repository.js';

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
    const { characterId, conversationId, content, conversationMode } = req.body;

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
        conversationMode: conversationMode || 'default',
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

  /**
   * PATCH /api/chat/messages/:id
   * Edit message content
   */
  async editMessage(req, res, next) {
    try {
      const messageId = req.params.id;
      const { content } = req.body;
      const updated = await chatService.editMessage({
        userId: req.user.id,
        messageId,
        content,
      });

      return res.json({
        success: true,
        data: updated,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/chat/messages/:id
   * Delete message
   */
  async deleteMessage(req, res, next) {
    try {
      const messageId = req.params.id;
      const result = await chatService.deleteMessage({
        userId: req.user.id,
        messageId,
      });

      return res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST/GET /api/chat/:messageId/speak or /api/chat/messages/:messageId/speak
   * Synthesize voice for a given chat message using fal.ai F5-TTS
   */
  async speakMessage(req, res, next) {
    try {
      const messageId = req.params.messageId || req.params.id;
      if (!messageId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_MESSAGE_ID',
            message: 'Message ID is required.',
          },
        });
      }

      const message = await messageRepository.findById(messageId);
      if (!message) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'MESSAGE_NOT_FOUND',
            message: `Message with ID ${messageId} was not found.`,
          },
        });
      }

      // Check conversation & user authorization
      const conversation = await conversationRepository.findById(message.conversation_id, req.user?.id);
      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found or access denied.',
          },
        });
      }

      // Look up character
      let character = null;
      if (conversation.character_id) {
        character = await characterRepository.findById(conversation.character_id);
      }

      // Synthesize audio using fal.ai F5-TTS with character reference audio or default
      const textToSpeak = (message.content || '').trim();
      if (!textToSpeak) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'EMPTY_CONTENT',
            message: 'Message has no text content to synthesize into speech.',
          },
        });
      }

      const refAudioUrl = character?.voice_sample_url || null;
      let refText = '';
      if (character?.voice_settings) {
        try {
          const vs = typeof character.voice_settings === 'string'
            ? JSON.parse(character.voice_settings)
            : character.voice_settings;
          refText = vs?.ref_text || '';
        } catch {
          refText = '';
        }
      }

      let speechResult;
      if (falVoiceService.isConfigured()) {
        try {
          speechResult = await falVoiceService.generateSpeech({
            text: textToSpeak,
            refAudioUrl,
            refText,
            modelType: 'F5-TTS',
            removeSilence: true,
          });
        } catch (falErr) {
          console.warn('[CHAT SPEAK] Fal.ai F5-TTS synthesis failed, falling back:', falErr.message);
          speechResult = await ttsService.generateSpeechUrl({
            text: textToSpeak,
            refAudioUrl,
            voiceSettings: character?.voice_settings,
            refText,
          });
        }
      } else {
        speechResult = await ttsService.generateSpeechUrl({
          text: textToSpeak,
          refAudioUrl,
          voiceSettings: character?.voice_settings,
          refText,
        });
      }

      const audioUrl = speechResult.audioUrl;
      const durationSeconds = speechResult.duration || Math.max(1, Math.round(textToSpeak.length / 14));

      // Persist updated audio URL onto the message
      const updatedMessage = await messageRepository.updateAudio(message.id, audioUrl, durationSeconds);

      return res.status(200).json({
        success: true,
        message: 'Speech synthesized successfully via fal.ai F5-TTS.',
        data: {
          messageId: message.id,
          audioUrl,
          durationSeconds,
          text: message.content,
          characterId: character?.id || null,
          characterName: character?.name || null,
          message: updatedMessage,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const chatController = new ChatController();
export default chatController;
