import characterRepository from '../repositories/character.repository.js';
import memoryRepository from '../repositories/memory.repository.js';

export class CharacterService {
  /**
   * Fetch all characters accessible to the user
   */
  async getCharacters(userId) {
    return await characterRepository.findAllByUserId(userId);
  }

  /**
   * Fetch a single character by id
   */
  async getCharacterById(id, userId) {
    const character = await characterRepository.findById(id);
    if (!character) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    // Must be user's own character or a system character
    if (character.user_id !== userId && !character.is_system) {
      const err = new Error('Access to this character is forbidden.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return character;
  }

  /**
   * Create a new custom character
   */
  async createCharacter(userId, characterData) {
    const {
      name,
      relationship_type,
      avatarUrl,
      gender,
      personality,
      tone,
      humor,
      friendliness,
      creativity,
      style,
      nicknames_for_user,
      catchphrases,
      speech_quirks,
      shared_memories_seed,
      backstory,
      interests,
      greeting,
      voice_provider,
      voiceProvider,
      voice_id,
      voiceId,
      voice_sample_url,
      voiceSampleUrl,
      voice_settings,
      voiceSettings,
    } = characterData;

    if (!name || !personality || !tone || !style || !greeting) {
      const err = new Error('Name, personality, tone, style, and greeting are required.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const parseArrayInput = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return [];
    };

    const character = await characterRepository.create({
      userId,
      name: name.trim(),
      relationshipType: relationship_type || 'friend',
      avatarUrl: avatarUrl ? avatarUrl.trim() : null,
      voiceProvider: voice_provider || voiceProvider || 'preset',
      voiceId: voice_id || voiceId || 'alloy',
      voiceSampleUrl: voice_sample_url || voiceSampleUrl || null,
      voiceSettings: voice_settings || voiceSettings || null,
      gender: gender ? gender.trim() : null,
      personality: personality.trim(),
      tone: tone.trim(),
      humor: humor !== undefined ? Math.min(10, Math.max(1, parseInt(humor, 10))) : 5,
      friendliness: friendliness !== undefined ? Math.min(10, Math.max(1, parseInt(friendliness, 10))) : 5,
      creativity: creativity !== undefined ? Math.min(10, Math.max(1, parseInt(creativity, 10))) : 5,
      style: style.trim(),
      nicknamesForUser: parseArrayInput(nicknames_for_user),
      catchphrases: parseArrayInput(catchphrases),
      speechQuirks: speech_quirks ? speech_quirks.trim() : null,
      sharedMemoriesSeed: shared_memories_seed ? shared_memories_seed.trim() : null,
      backstory: backstory ? backstory.trim() : null,
      interests: parseArrayInput(interests),
      greeting: greeting.trim(),
      isSystem: false,
    });

    if (shared_memories_seed && shared_memories_seed.trim()) {
      try {
        await memoryRepository.createPersonaAnchor({
          userId,
          characterId: character.id,
          content: shared_memories_seed.trim(),
          importanceScore: 5,
        });
      } catch (memErr) {
        console.warn('[CHARACTER SERVICE] Failed to create seed persona anchor:', memErr.message);
      }
    }

    return character;
  }

  /**
   * Update character details
   */
  async updateCharacter(id, userId, updates) {
    const existing = await characterRepository.findById(id);
    if (!existing) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    if (existing.is_system) {
      const err = new Error('System characters cannot be modified.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const parseArrayInput = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return [];
    };

    const sanitizedUpdates = { ...updates };
    if (sanitizedUpdates.nicknames_for_user !== undefined) {
      sanitizedUpdates.nicknames_for_user = parseArrayInput(sanitizedUpdates.nicknames_for_user);
    }
    if (sanitizedUpdates.catchphrases !== undefined) {
      sanitizedUpdates.catchphrases = parseArrayInput(sanitizedUpdates.catchphrases);
    }
    if (sanitizedUpdates.interests !== undefined) {
      sanitizedUpdates.interests = parseArrayInput(sanitizedUpdates.interests);
    }
    if (sanitizedUpdates.voiceProvider !== undefined) {
      sanitizedUpdates.voice_provider = sanitizedUpdates.voiceProvider;
    }
    if (sanitizedUpdates.voiceId !== undefined) {
      sanitizedUpdates.voice_id = sanitizedUpdates.voiceId;
    }
    if (sanitizedUpdates.voiceSampleUrl !== undefined) {
      sanitizedUpdates.voice_sample_url = sanitizedUpdates.voiceSampleUrl;
    }
    if (sanitizedUpdates.voiceSettings !== undefined) {
      sanitizedUpdates.voice_settings = sanitizedUpdates.voiceSettings;
    }

    const updated = await characterRepository.update(id, userId, sanitizedUpdates);
    return updated;
  }

  /**
   * Delete a custom character
   */
  async deleteCharacter(id, userId) {
    const existing = await characterRepository.findById(id);
    if (!existing) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    if (existing.is_system) {
      const err = new Error('System characters cannot be deleted.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    if (existing.user_id !== userId) {
      const err = new Error('You can only delete your own characters.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return await characterRepository.delete(id, userId);
  }
}

export const characterService = new CharacterService();
export default characterService;
