import characterService from '../services/character.service.js';
import falVoiceService from '../services/voice/fal-voice.service.js';
import sttService from '../services/voice/stt.service.js';

export class CharacterController {
  async getCharacters(req, res, next) {
    try {
      const characters = await characterService.getCharacters(req.user.id);
      return res.status(200).json({
        success: true,
        data: characters,
      });
    } catch (err) {
      return next(err);
    }
  }

  async getCharacterById(req, res, next) {
    try {
      const character = await characterService.getCharacterById(req.params.id, req.user.id);
      return res.status(200).json({
        success: true,
        data: character,
      });
    } catch (err) {
      return next(err);
    }
  }

  async createCharacter(req, res, next) {
    try {
      const character = await characterService.createCharacter(req.user.id, req.body);
      return res.status(201).json({
        success: true,
        message: 'Character created successfully.',
        data: character,
      });
    } catch (err) {
      return next(err);
    }
  }

  async updateCharacter(req, res, next) {
    try {
      const character = await characterService.updateCharacter(req.params.id, req.user.id, req.body);
      return res.status(200).json({
        success: true,
        message: 'Character updated successfully.',
        data: character,
      });
    } catch (err) {
      return next(err);
    }
  }

  async deleteCharacter(req, res, next) {
    try {
      await characterService.deleteCharacter(req.params.id, req.user.id);
      return res.status(200).json({
        success: true,
        message: 'Character deleted successfully.',
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/characters/generate-magic
   * Synthesize a complete character persona from a 1-sentence prompt
   */
  async generateMagicPersona(req, res, next) {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Please provide a short description of who you want to create.',
          },
        });
      }

      const data = await characterService.generateMagicPersona(prompt.trim());
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/characters/preview-vibe
   * Generate a 1-turn sample response for a draft persona before saving
   */
  async previewPersonaVibe(req, res, next) {
    try {
      const { personaDraft, sampleUserPrompt } = req.body;
      const data = await characterService.previewPersonaVibe(personaDraft || {}, sampleUserPrompt || '');
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/characters/:id/voice-sample
   * Upload character audio reference sample and store in fal cloud storage
   */
  async uploadVoiceSample(req, res, next) {
    try {
      const characterId = req.params.id;
      const character = await characterService.getCharacterById(characterId, req.user.id);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      let sampleUrl = req.body.sample_url || req.body.voice_sample_url || req.body.ref_audio_url;
      let refText = req.body.ref_text || req.body.transcript || '';

      if (req.file && req.file.buffer) {
        sampleUrl = await falVoiceService.uploadAudioSample(
          req.file.buffer,
          req.file.originalname || 'voice_sample.wav',
          req.file.mimetype || 'audio/wav'
        );

        // Auto-transcribe the uploaded sample for high-precision F5-TTS zero-shot voice alignment
        try {
          const trans = await sttService.transcribeAudio(
            req.file.buffer,
            req.file.originalname || 'voice_sample.wav',
            req.file.mimetype || 'audio/wav'
          );
          if (trans?.transcript) {
            refText = trans.transcript.trim();
          }
        } catch (transErr) {
          console.warn('[VOICE SAMPLE AUTO-TRANSCRIBE NOTE]', transErr.message);
        }
      }

      if (!sampleUrl) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_AUDIO_SAMPLE',
            message: 'Please provide an audio sample file or sample_url.',
          },
        });
      }

      const existingSettings = character.voice_settings
        ? (typeof character.voice_settings === 'string' ? JSON.parse(character.voice_settings) : character.voice_settings)
        : {};

      const updatedSettings = {
        ...existingSettings,
        ...(refText ? { ref_text: refText } : {}),
      };

      const updated = await characterService.updateCharacter(characterId, req.user.id, {
        voice_sample_url: sampleUrl,
        voice_provider: 'cloned',
        voice_settings: updatedSettings,
      });

      return res.status(200).json({
        success: true,
        message: 'Voice sample uploaded and stored in fal cloud storage successfully.',
        data: {
          characterId: updated.id,
          voice_sample_url: updated.voice_sample_url,
          voice_provider: updated.voice_provider,
          character: updated,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/characters/:id/voice-sample
   * Retrieve character's current voice reference sample
   */
  async getVoiceSample(req, res, next) {
    try {
      const character = await characterService.getCharacterById(req.params.id, req.user.id);
      if (!character) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Character not found.' },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          characterId: character.id,
          name: character.name,
          voice_sample_url: character.voice_sample_url,
          voice_provider: character.voice_provider,
          voice_id: character.voice_id,
        },
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const characterController = new CharacterController();
export default characterController;
