import characterService from '../services/character.service.js';

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
}

export const characterController = new CharacterController();
export default characterController;
