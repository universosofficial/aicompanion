import baseRepository from './base.repository.js';

/**
 * CharacterRepository
 * Database access layer for character personas with relational persona support.
 */
export class CharacterRepository {
  /**
   * Insert a new character record.
   */
  async create({
    userId,
    name,
    relationshipType = 'friend',
    avatarUrl = null,
    gender = null,
    personality,
    tone,
    humor = 5,
    friendliness = 5,
    creativity = 5,
    style,
    nicknamesForUser = [],
    catchphrases = [],
    speechQuirks = null,
    sharedMemoriesSeed = null,
    backstory = null,
    interests = [],
    greeting,
    isSystem = false,
    voiceProvider = 'preset',
    voiceId = 'alloy',
    voiceSampleUrl = null,
    voiceSettings = null,
  }) {
    const sql = `
      INSERT INTO characters (
        user_id, name, relationship_type, avatar_url, voice_provider, voice_id, voice_sample_url, voice_settings,
        gender, personality, tone, humor, friendliness, creativity, style, nicknames_for_user, catchphrases,
        speech_quirks, shared_memories_seed, backstory, interests, greeting, is_system
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const serializedNicknames = Array.isArray(nicknamesForUser) || typeof nicknamesForUser === 'object'
      ? JSON.stringify(nicknamesForUser)
      : JSON.stringify([]);

    const serializedCatchphrases = Array.isArray(catchphrases) || typeof catchphrases === 'object'
      ? JSON.stringify(catchphrases)
      : JSON.stringify([]);

    const serializedInterests = Array.isArray(interests) || typeof interests === 'object'
      ? JSON.stringify(interests)
      : JSON.stringify([]);

    const serializedVoiceSettings = voiceSettings && typeof voiceSettings === 'object'
      ? JSON.stringify(voiceSettings)
      : (typeof voiceSettings === 'string' ? voiceSettings : null);

    const result = await baseRepository.execute(sql, [
      userId,
      name,
      relationshipType,
      avatarUrl,
      voiceProvider || 'preset',
      voiceId || 'alloy',
      voiceSampleUrl || null,
      serializedVoiceSettings,
      gender,
      personality,
      tone,
      humor,
      friendliness,
      creativity,
      style,
      serializedNicknames,
      serializedCatchphrases,
      speechQuirks,
      sharedMemoriesSeed,
      backstory,
      serializedInterests,
      greeting,
      isSystem ? 1 : 0,
    ]);

    return await this.findById(result.insertId);
  }

  /**
   * Find all characters accessible to a user (user-created + system characters).
   * @param {number|string} userId
   * @returns {Promise<Array>}
   */
  async findAllByUserId(userId) {
    const sql = `
      SELECT 
        c.*,
        0 AS is_subscribed
      FROM characters c
      WHERE c.user_id = ? OR c.is_system = TRUE
      ORDER BY c.is_system DESC, c.created_at DESC
    `;

    const [rows] = await baseRepository.query(sql, [userId]);
    return rows.map((r) => this.formatCharacter(r));
  }

  /**
   * Find character by primary key.
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const sql = `
      SELECT *
      FROM characters
      WHERE id = ?
      LIMIT 1
    `;

    const row = await baseRepository.queryOne(sql, [id]);
    return row ? this.formatCharacter(row) : null;
  }

  /**
   * Update character attributes (enforces ownership and protects system characters).
   * @param {number|string} id
   * @param {number|string} userId
   * @param {Object} updates
   * @returns {Promise<Object|null>}
   */
  async update(id, userId, updates) {
    const fields = [];
    const values = [];

    const allowedFields = [
      'name', 'relationship_type', 'avatar_url', 'gender', 'personality', 'tone',
      'humor', 'friendliness', 'creativity', 'style', 'nicknames_for_user',
      'catchphrases', 'speech_quirks', 'shared_memories_seed', 'backstory',
      'interests', 'greeting',
      'voice_provider', 'voice_id', 'voice_sample_url', 'voice_settings',
      'is_public', 'is_verified', 'handle', 'headline', 'website_url', 'philosophy_statement',
      'decision_frameworks', 'mental_models', 'tags', 'total_subscribers',
    ];

    const jsonFields = ['interests', 'nicknames_for_user', 'catchphrases', 'decision_frameworks', 'mental_models', 'tags', 'voice_settings'];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (jsonFields.includes(field)) {
          if (typeof updates[field] !== 'string') {
            values.push(JSON.stringify(updates[field]));
          } else {
            values.push(updates[field]);
          }
        } else if (field === 'is_public') {
          values.push(updates[field] ? 1 : 0);
        } else {
          values.push(updates[field]);
        }
      }
    }

    if (fields.length === 0) {
      return await this.findById(id);
    }

    const sql = `
      UPDATE characters
      SET ${fields.join(', ')}
      WHERE id = ? AND user_id = ? AND is_system = FALSE
    `;

    values.push(id, userId);
    const result = await baseRepository.execute(sql, values);

    if (result.affectedRows === 0) {
      return null;
    }

    return await this.findById(id);
  }

  /**
   * Delete a character (enforces ownership and prevents system character deletion).
   * @param {number|string} id
   * @param {number|string} userId
   * @returns {Promise<boolean>}
   */
  async delete(id, userId) {
    const sql = `
      DELETE FROM characters
      WHERE id = ? AND user_id = ? AND is_system = FALSE
    `;
    const result = await baseRepository.execute(sql, [id, userId]);
    return result.affectedRows > 0;
  }

  /**
   * Format database character record (parsing JSON fields, boolean conversion).
   */
  formatCharacter(row) {
    if (!row) return null;

    const parseJsonArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return val.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      return [];
    };

    return {
      ...row,
      relationship_type: row.relationship_type || 'friend',
      is_system: Boolean(row.is_system),
      is_public: Boolean(row.is_public),
      is_verified: Boolean(row.is_verified),
      is_subscribed: Boolean(row.is_subscribed),
      handle: row.handle || null,
      headline: row.headline || '',
      website_url: row.website_url || null,
      philosophy_statement: row.philosophy_statement || '',
      total_interactions: Number(row.total_interactions) || 0,
      total_subscribers: Number(row.total_subscribers) || 0,
      interests: parseJsonArray(row.interests),
      decision_frameworks: parseJsonArray(row.decision_frameworks || row.mental_models),
      mental_models: parseJsonArray(row.mental_models || row.decision_frameworks),
      tags: parseJsonArray(row.tags),
      nicknames_for_user: parseJsonArray(row.nicknames_for_user),
      catchphrases: parseJsonArray(row.catchphrases),
      speech_quirks: row.speech_quirks || '',
      shared_memories_seed: row.shared_memories_seed || '',
      voice_provider: row.voice_provider || 'preset',
      voice_id: row.voice_id || 'alloy',
      voice_sample_url: row.voice_sample_url || null,
      voice_settings: typeof row.voice_settings === 'string'
        ? (() => { try { return JSON.parse(row.voice_settings); } catch { return {}; } })()
        : (row.voice_settings || {}),
    };
  }
}

export const characterRepository = new CharacterRepository();
export default characterRepository;
