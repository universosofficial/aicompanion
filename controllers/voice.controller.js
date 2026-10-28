import ttsService from '../services/voice/tts.service.js';
import sttService from '../services/voice/stt.service.js';
import voiceCloningService from '../services/voice/cloning.service.js';
import characterRepository from '../repositories/character.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import messageRepository from '../repositories/message.repository.js';
import userMindRepository from '../repositories/user-mind.repository.js';
import mindKnowledgeRepository from '../repositories/mind-knowledge.repository.js';
import mindRepository from '../repositories/mind.repository.js';
import promptService, { buildMindConsultationPrompt } from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';
import memoryService from '../services/ai/memory.service.js';
import summaryService from '../services/ai/summary.service.js';
import moderationService from '../services/ai/moderation.service.js';
import baseRepository from '../repositories/base.repository.js';
import cloudinaryService from '../services/cloudinary.service.js';
import env from '../config/env.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Persist an audio buffer to Cloudinary CDN (with local fallback) and return accessible URL.
 */
async function saveVoiceNoteFile(buffer, prefix = 'voice', ext = 'wav') {
  try {
    // 1. Offload to Cloudinary CDN for persistent zero-disk storage
    if (cloudinaryService.isConfigured()) {
      const mime = ext === 'wav' ? 'audio/wav' : (ext === 'webm' ? 'audio/webm' : 'audio/mpeg');
      const uploadResult = await cloudinaryService.uploadAudioBuffer(buffer, {
        folder: 'ai_companion/voice_notes',
        mimetype: mime,
        publicId: `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      });
      if (uploadResult?.url) {
        return uploadResult.url;
      }
    }

    // 2. Resilient local disk fallback
    const notesDir = path.resolve('uploads', 'voice_notes');
    await fs.mkdir(notesDir, { recursive: true });
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
    const filePath = path.join(notesDir, filename);
    await fs.writeFile(filePath, buffer);
    const host = process.env.PUBLIC_APP_URL || `http://localhost:${env.PORT || 5005}`;
    return `${host}/uploads/voice_notes/${filename}`;
  } catch (err) {
    console.warn('[VOICE NOTE PERSIST ERROR]', err.message);
    return null;
  }
}

export class VoiceController {
  /**
   * GET /api/voice/presets
   * Fetch all curated voice presets with relationship hints and previews.
   */
  async getPresets(req, res, next) {
    try {
      const presets = ttsService.getPresets();
      return res.status(200).json({
        success: true,
        data: presets,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/voice/clone
   * Upload an audio sample to clone a voice profile.
   */
  async cloneVoice(req, res, next) {
    try {
      const consentValid = moderationService.validateVoiceConsent(
        req.body?.consent ?? req.body?.voice_consent
      );
      if (!consentValid.valid) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VOICE_CONSENT_REQUIRED',
            message: consentValid.error,
          },
        });
      }

      if (!req.file || !req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_AUDIO_SAMPLE',
            message: 'Please provide an audio sample (.mp3, .wav, or .m4a) to clone a voice.',
          },
        });
      }

      const { name, description } = req.body;
      const result = await voiceCloningService.cloneVoiceFromSample({
        name: name || 'Custom Voice',
        audioBuffer: req.file.buffer,
        filename: req.file.originalname || 'sample.mp3',
        mimeType: req.file.mimetype || 'audio/mpeg',
        description: description || '',
      });

      return res.status(200).json({
        success: true,
        message: 'Voice profile configured successfully.',
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/voice/transcribe
   * Transcribe a recorded microphone audio chunk via OpenAI Whisper.
   */
  async transcribeAudio(req, res, next) {
    const startTime = Date.now();
    try {
      let audioBuffer = null;
      let filename = 'recording.webm';
      let mimeType = 'audio/webm';

      if (req.file && req.file.buffer) {
        audioBuffer = req.file.buffer;
        filename = req.file.originalname || filename;
        mimeType = req.file.mimetype || mimeType;
      } else if (req.body.audioBase64) {
        audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
        mimeType = req.body.mimeType || mimeType;
      }

      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_AUDIO',
            message: 'Audio data is required for transcription.',
          },
        });
      }

      const transcription = await sttService.transcribeAudio(audioBuffer, filename, mimeType);
      const latencyMs = Date.now() - startTime;

      // Telemetry log if user authenticated
      if (req.user?.id) {
        try {
          await baseRepository.execute(
            `INSERT INTO voice_audio_logs (user_id, direction, audio_duration_seconds, latency_ms)
             VALUES (?, 'user_mic_stt', ?, ?)`,
            [req.user.id, transcription.duration || null, latencyMs]
          );
        } catch (logErr) {
          console.warn('[VOICE CONTROLLER] Log STT telemetry failed:', logErr.message);
        }
      }

      return res.status(200).json({
        success: true,
        data: transcription,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/voice/speak
   * Synthesize text to speech using OpenAI TTS / ElevenLabs.
   */
  async speakText(req, res, next) {
    const startTime = Date.now();
    try {
      const {
        text,
        voiceId = 'alloy',
        voiceSettings = {},
        provider = 'preset',
        format,
        voiceSampleUrl,
        refAudioUrl,
        refText,
      } = req.body;

      if (!text || !text.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_TEXT',
            message: 'Text is required for speech synthesis.',
          },
        });
      }

      let resolvedRefUrl = refAudioUrl || voiceSampleUrl || voiceSettings?.voiceSampleUrl || voiceSettings?.sampleUrl || null;
      let resolvedRefText = refText || voiceSettings?.ref_text || voiceSettings?.transcript || '';

      // If reference audio is missing but voiceId is a cloned voice ID, query character repository
      if (!resolvedRefUrl && voiceId && voiceId.startsWith('cloned_')) {
        try {
          const [rows] = await baseRepository.query(
            'SELECT voice_sample_url, voice_settings FROM characters WHERE voice_id = ? LIMIT 1',
            [voiceId]
          );
          if (rows && rows.length > 0 && rows[0].voice_sample_url) {
            resolvedRefUrl = rows[0].voice_sample_url;
            const vs = typeof rows[0].voice_settings === 'string'
              ? JSON.parse(rows[0].voice_settings || '{}')
              : (rows[0].voice_settings || {});
            resolvedRefText = vs?.ref_text || resolvedRefText;
          }
        } catch (dbErr) {
          console.warn('[VOICE CONTROLLER] Cloned voice DB lookup note:', dbErr.message);
        }
      }

      const audioBuffer = await ttsService.generateSpeechBuffer({
        text,
        voiceId,
        voiceSettings,
        provider: resolvedRefUrl ? 'cloned' : provider,
        refAudioUrl: resolvedRefUrl,
        refText: resolvedRefText,
      });

      const latencyMs = Date.now() - startTime;

      if (req.user?.id) {
        try {
          await baseRepository.execute(
            `INSERT INTO voice_audio_logs (user_id, direction, characters_billed, latency_ms)
             VALUES (?, 'ai_speech_tts', ?, ?)`,
            [req.user.id, text.length, latencyMs]
          );
        } catch (logErr) {
          console.warn('[VOICE CONTROLLER] Log TTS telemetry failed:', logErr.message);
        }
      }

      // Return base64 if explicitly requested
      if (format === 'base64' || req.query.format === 'base64') {
        return res.status(200).json({
          success: true,
          data: {
            audioBase64: audioBuffer.toString('base64'),
            mimeType: 'audio/mpeg',
            characterCount: text.length,
          },
        });
      }

      // Otherwise send binary stream
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.end(audioBuffer);
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/voice/turn (and /api/chat/voice-turn)
   * Full end-to-end Voice Call Turn:
   * 1. STT User Audio -> Transcript
   * 2. Execute persona/mind intelligence turn & persist in database
   * 3. TTS Assistant response -> Audio Buffer
   * 4. Return transcript, AI response text, and base64 audio
   */
  async voiceTurn(req, res, next) {
    const turnStartTime = Date.now();
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required for voice calls.' },
        });
      }

      const {
        characterId,
        conversationId,
        mindHandle,
        mindId,
        text,
      } = req.body;

      // 1. Resolve audio buffer if uploaded (mic WAV / WebM or base64)
      let audioBuffer = null;
      let filename = 'recording.wav';
      let mimeType = 'audio/wav';

      if (req.file && req.file.buffer) {
        audioBuffer = req.file.buffer;
        filename = req.file.originalname || filename;
        mimeType = req.file.mimetype || mimeType;
      } else if (req.body.audioBase64) {
        audioBuffer = Buffer.from(req.body.audioBase64, 'base64');
        mimeType = req.body.mimeType || mimeType;
      }

      // 2. Resolve user transcript: from uploaded mic audio or directly provided text
      let transcript = (text || '').trim();

      if (!transcript) {
        if (!audioBuffer || audioBuffer.length < 200) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'EMPTY_AUDIO',
              message: 'No speech detected. Please speak into your microphone and tap Done Speaking.',
            },
          });
        }

        try {
          const sttResult = await sttService.transcribeAudio(audioBuffer, filename, mimeType);
          transcript = (sttResult.transcript || '').trim();
        } catch (sttErr) {
          console.warn('[VOICE TURN STT ERROR]', sttErr.message);
          return res.status(400).json({
            success: false,
            error: {
              code: 'AUDIO_PROCESSING_ERROR',
              message: 'Could not process audio format. Please try speaking again.',
            },
          });
        }
      }

      if (!transcript) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INCOMPREHENSIBLE_AUDIO',
            message: 'Could not clearly recognize speech from audio. Please speak clearly.',
          },
        });
      }

      // Safety & Content Moderation Scan on user speech transcript
      const moderation = await moderationService.checkContent(transcript, {
        isPublic: Boolean(mindHandle || mindId),
      });
      if (moderation.isHardViolation) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'POLICY_VIOLATION',
            message: moderation.reason || 'This audio transcript violates Univasos safety policies.',
          },
        });
      }
      const isCrisis = Boolean(moderation.isCrisis);

      // =========================================================================
      // CASE A: PRIVATE COMPANION OR SYSTEM CHARACTER
      // =========================================================================
      if (characterId) {
        const character = await characterRepository.findById(characterId);
        if (!character) {
          return res.status(404).json({
            success: false,
            error: { code: 'CHARACTER_NOT_FOUND', message: 'Character companion not found.' },
          });
        }

        const isOwner = character.user_id === userId;
        const isPublic = Boolean(character.is_public);
        const isSystem = Boolean(character.is_system);

        if (!isOwner && !isSystem && !isPublic) {
          const isSubscribed = await mindRepository.isSubscribed(userId, characterId);
          if (!isSubscribed) {
            return res.status(403).json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'Access denied to this character.' },
            });
          }
        }

        // Fetch or create conversation
        let conversation = null;
        if (conversationId) {
          conversation = await conversationRepository.findById(conversationId, userId);
        }
        if (!conversation) {
          conversation = await conversationRepository.findByUserAndCharacter(userId, characterId);
          if (!conversation) {
            conversation = await conversationRepository.create({
              userId,
              characterId,
              title: `Chat with ${character.name}`,
            });

            if (character.greeting) {
              await messageRepository.create({
                conversationId: conversation.id,
                senderType: 'assistant',
                content: character.greeting,
                tokenCount: Math.ceil(character.greeting.length / 4),
              });
            }
          }
        }

        // Save user voice note audio file if voice audio was submitted
        let userAudioUrl = null;
        let userDuration = null;
        const isUserVoice = !!(audioBuffer && audioBuffer.length > 0);

        if (isUserVoice) {
          const isWavFile = (filename && filename.endsWith('.wav')) || (mimeType && mimeType.includes('wav'));
          const userAudioExt = isWavFile ? 'wav' : 'webm';
          userAudioUrl = await saveVoiceNoteFile(audioBuffer, 'user_voice', userAudioExt);
          userDuration = isWavFile
            ? Math.max(1, Math.round((audioBuffer.length - 44) / (16000 * 2)))
            : Math.max(1, Math.round(audioBuffer.length / 16000));
        }

        // Persist user voice note message into database
        const savedUserMessage = await messageRepository.create({
          conversationId: conversation.id,
          senderType: 'user',
          messageType: isUserVoice ? 'voice' : 'text',
          content: transcript,
          audioUrl: userAudioUrl,
          durationSeconds: userDuration,
          tokenCount: Math.ceil(transcript.length / 4),
        });

        // Contextual retrieval: memories, summary, recent turns
        const retrievalPromises = [
          memoryService.getMemoriesForPrompt({ userId, characterId, limit: 5 }),
          summaryService.getSummaryForPrompt(conversation.id),
          messageRepository.findRecentByConversationId(conversation.id, 8),
        ];

        if (isPublic) {
          retrievalPromises.push(mindRepository.findRelevantKnowledge(characterId, transcript, 5));
        }

        const [memories, summary, recentHistory, retrievedChunks = []] = await Promise.all(retrievalPromises);

        // System prompt with Socratic mentor pacing & dedicated 45s-1min voice note directive
        const systemPrompt = promptService.buildSystemPrompt({
          character,
          memories,
          summary,
          retrievedChunks,
          isVoiceNote: true,
          isCrisis,
        });

        const historyWithoutCurrent = recentHistory.filter((m) => m.id !== savedUserMessage.id);
        const messagesPayload = [
          { role: 'system', content: systemPrompt },
          ...historyWithoutCurrent.map((msg) => ({
            role: msg.sender_type === 'assistant' ? 'assistant' : 'user',
            content: msg.content,
          })),
          { role: 'user', content: transcript },
        ];

        // AI Voice Turn Generation (target: 45s to 1 min audio, approx 110-150 words)
        const aiResponse = await openAiService.generateChatCompletion({
          messages: messagesPayload,
          max_tokens: 500,
        });

        const replyText = (aiResponse.content || '').trim();

        // Ensure cloned voice profile is active (ElevenLabs or acoustic matching)
        if (character.voice_provider === 'cloned') {
          await voiceCloningService.ensureClonedVoice(character);
        }

        const vs = typeof character.voice_settings === 'string'
          ? (() => { try { return JSON.parse(character.voice_settings); } catch { return {}; } })()
          : (character.voice_settings || {});

        // Synthesize Assistant Voice Audio
        const assistantAudioBuffer = await ttsService.generateSpeechBuffer({
          text: replyText,
          voiceId: character.voice_id || 'alloy',
          provider: character.voice_provider || 'preset',
          voiceSettings: vs,
          refAudioUrl: character.voice_sample_url || vs?.voiceSampleUrl || vs?.sampleUrl || null,
          refText: vs?.ref_text || '',
        });

        // Save assistant voice note audio file
        const assistantAudioUrl = await saveVoiceNoteFile(assistantAudioBuffer, 'assistant_voice', 'mp3');
        const assistantDuration = Math.max(45, Math.round(replyText.length / 14));

        // Persist AI voice note reply into database
        const savedAssistantMessage = await messageRepository.create({
          conversationId: conversation.id,
          senderType: 'assistant',
          messageType: 'voice',
          content: replyText,
          audioUrl: assistantAudioUrl,
          durationSeconds: assistantDuration,
          tokenCount: Math.ceil(replyText.length / 4),
        });

        // Trigger memory & summary extraction in background
        const backgroundTurns = [
          { sender_type: 'user', content: transcript },
          { sender_type: 'assistant', content: replyText },
        ];
        memoryService.extractAndSaveMemoriesAsync({
          userId,
          characterId,
          characterName: character.name,
          recentTurns: backgroundTurns,
          conversationId: conversation.id,
          conversationTimestamp: new Date(),
        }).catch((err) => {
          console.warn('[VOICE TURN MEMORY ERROR]', err.message);
        });

        summaryService.processRollingSummaryAsync({
          conversationId: conversation.id,
          recentTurns: backgroundTurns,
        }).catch((err) => {
          console.warn('[VOICE TURN SUMMARY ERROR]', err.message);
        });

        const latencyMs = Date.now() - turnStartTime;

        // Telemetry logging
        try {
          await baseRepository.execute(
            `INSERT INTO voice_audio_logs (user_id, character_id, conversation_id, direction, characters_billed, latency_ms)
             VALUES (?, ?, ?, 'ai_speech_tts', ?, ?)`,
            [userId, character.id, conversation.id, replyText.length, latencyMs]
          );
        } catch (_) {}

        return res.status(200).json({
          success: true,
          data: {
            userTranscript: transcript,
            replyText,
            crisisDetected: isCrisis,
            crisisHotline: isCrisis ? moderation.crisisHotline : null,
            audioBase64: assistantAudioBuffer.toString('base64'),
            audioUrl: assistantAudioUrl,
            userAudioUrl,
            durationSeconds: assistantDuration,
            userDurationSeconds: userDuration,
            mimeType: 'audio/mpeg',
            character: {
              id: character.id,
              name: character.name,
              avatarUrl: character.avatar_url,
              voiceId: character.voice_id || 'alloy',
            },
            conversationId: conversation.id,
            userMessage: savedUserMessage,
            assistantMessage: savedAssistantMessage,
          },
        });
      }

      // =========================================================================
      // CASE B: 1:1 PUBLIC DIGITAL TWIN MIND CONSULTATION
      // =========================================================================
      if (mindHandle || mindId) {
        let mind = null;
        if (mindHandle) {
          mind = await userMindRepository.findByHandle(mindHandle);
        } else if (mindId) {
          mind = await userMindRepository.findById(mindId);
        }

        if (!mind || (!mind.is_published && mind.user_id !== userId)) {
          return res.status(404).json({
            success: false,
            error: { code: 'MIND_NOT_FOUND', message: 'Public AI Mind not found or is currently private.' },
          });
        }

        // Retrieve knowledge chunks grounded in mind's ingested works
        const retrievedChunks = await mindKnowledgeRepository.findRelevantKnowledge(mind.id, transcript, 5);

        // Find or create consultation session & log turns
        const activeSession = await mindKnowledgeRepository.findOrCreateConsultationSession(
          userId,
          mind.id,
          `Voice Consultation with ${mind.display_name}`
        );

        const recentTurns = await mindKnowledgeRepository.findRecentConsultationMessages(activeSession.id, 6);
        const visitorMemories = await memoryService.getMemoriesForPrompt({
          userId,
          characterId: null,
          limit: 5,
        });

        // Save user voice note audio file if voice audio was submitted
        let userAudioUrl = null;
        let userDuration = null;
        const isUserVoice = !!(audioBuffer && audioBuffer.length > 0);

        if (isUserVoice) {
          const isWavFile = (filename && filename.endsWith('.wav')) || (mimeType && mimeType.includes('wav'));
          const userAudioExt = isWavFile ? 'wav' : 'webm';
          userAudioUrl = await saveVoiceNoteFile(audioBuffer, 'user_voice', userAudioExt);
          userDuration = isWavFile
            ? Math.max(1, Math.round((audioBuffer.length - 44) / (16000 * 2)))
            : Math.max(1, Math.round(audioBuffer.length / 16000));
        }

        // Record incoming user message
        const savedUserTurn = await mindKnowledgeRepository.createConsultationMessage(
          activeSession.id,
          'user',
          transcript,
          isUserVoice ? 'voice' : 'text',
          userAudioUrl,
          userDuration
        );

        // Assemble Socratic consultation system prompt with 45s-1min voice memo directive
        let systemPrompt = buildMindConsultationPrompt(mind, retrievedChunks, visitorMemories, new Date(), true);
        if (isCrisis) {
          systemPrompt += '\n\n[CRITICAL SAFETY & CRISIS PROTOCOL: COMPASSIONATE DE-ESCALATION & HOPE]\nRespond with immediate human warmth, empathy, and presence. Never validate self-harm. Reassure the user of their worth and encourage calling or texting the 988 Lifeline (or findahelpline.com).';
        }

        const openAiMessages = [
          { role: 'system', content: systemPrompt },
          ...recentTurns.map((m) => ({
            role: m.sender_type === 'mind' ? 'assistant' : 'user',
            content: m.content,
          })),
          { role: 'user', content: transcript },
        ];

        const aiResponse = await openAiService.generateChatCompletion({
          messages: openAiMessages,
          max_tokens: 500,
        });

        const replyText = (aiResponse.content || '').trim();

        // Ensure cloned mind voice is active (ElevenLabs or acoustic matching)
        if (mind.voice_provider === 'cloned') {
          await voiceCloningService.ensureClonedMindVoice(mind);
        }

        const mvs = typeof mind.voice_settings === 'string'
          ? (() => { try { return JSON.parse(mind.voice_settings); } catch { return {}; } })()
          : (mind.voice_settings || {});

        // Synthesize speech using Mind's configured voice profile
        const mindAudioBuffer = await ttsService.generateSpeechBuffer({
          text: replyText,
          voiceId: mind.voice_id || 'echo',
          provider: mind.voice_provider || 'preset',
          voiceSettings: mvs,
          refAudioUrl: mind.voice_sample_url || mvs?.voiceSampleUrl || mvs?.sampleUrl || null,
          refText: mvs?.ref_text || '',
        });

        // Save assistant voice note audio file
        const assistantAudioUrl = await saveVoiceNoteFile(mindAudioBuffer, 'mind_voice', 'mp3');
        const assistantDuration = Math.max(45, Math.round(replyText.length / 14));

        // Persist AI consultation message
        const savedAssistantTurn = await mindKnowledgeRepository.createConsultationMessage(
          activeSession.id,
          'mind',
          replyText,
          'voice',
          assistantAudioUrl,
          assistantDuration
        );

        // Background memory extraction for visitor
        memoryService.extractAndSaveMemoriesAsync({
          userId,
          characterId: null,
          characterName: mind.display_name,
          recentTurns: [
            ...recentTurns,
            { sender_type: 'user', content: transcript },
            { sender_type: 'mind', content: replyText },
          ],
          conversationId: activeSession.id,
          conversationTimestamp: new Date(),
        }).catch((err) => console.warn('[VOICE TURN MIND MEMORY ERROR]', err.message));

        const latencyMs = Date.now() - turnStartTime;

        return res.status(200).json({
          success: true,
          data: {
            userTranscript: transcript,
            replyText,
            crisisDetected: isCrisis,
            crisisHotline: isCrisis ? moderation.crisisHotline : null,
            audioBase64: mindAudioBuffer.toString('base64'),
            audioUrl: assistantAudioUrl,
            userAudioUrl,
            durationSeconds: assistantDuration,
            userDurationSeconds: userDuration,
            mimeType: 'audio/mpeg',
            mind: {
              id: mind.id,
              handle: mind.handle,
              displayName: mind.display_name,
              avatarUrl: mind.avatar_url,
              voiceId: mind.voice_id || 'echo',
            },
            sessionId: activeSession.id,
            userMessage: savedUserTurn,
            assistantMessage: savedAssistantTurn,
            latencyMs,
          },
        });
      }

      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_TARGET',
          message: 'Either characterId or mindHandle/mindId must be provided for a voice turn.',
        },
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const voiceController = new VoiceController();
export default voiceController;
