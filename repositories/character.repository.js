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
    isSportsAnalyst = false,
    analysisStyle = 'quant_expected_value',
    primaryLeagues = [],
    riskTier = 'balanced_quarter_kelly',
  }) {
    const sql = `
      INSERT INTO characters (
        user_id, name, relationship_type, avatar_url, voice_provider, voice_id, voice_sample_url, voice_settings,
        gender, personality, tone, humor, friendliness, creativity, style, nicknames_for_user, catchphrases,
        speech_quirks, shared_memories_seed, backstory, interests, greeting, is_system,
        is_sports_analyst, analysis_style, primary_leagues, risk_tier
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    const serializedPrimaryLeagues = Array.isArray(primaryLeagues) || typeof primaryLeagues === 'object'
      ? JSON.stringify(primaryLeagues)
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
      isSportsAnalyst ? 1 : 0,
      analysisStyle || 'quant_expected_value',
      serializedPrimaryLeagues,
      riskTier || 'balanced_quarter_kelly',
    ]);

    return await this.findById(result.insertId);
  }

  /**
   * Find all characters accessible to a user (user-created, system characters, subscribed minds, and active conversations).
   * @param {number|string} userId
   * @returns {Promise<Array>}
   */
  async findAllByUserId(userId) {
    const sql = `
      SELECT * FROM (
        SELECT DISTINCT
          c.id,
          c.user_id,
          c.name,
          c.handle,
          c.headline,
          c.relationship_type,
          c.avatar_url,
          c.voice_provider,
          c.voice_id,
          c.voice_sample_url,
          c.voice_settings,
          c.website_url,
          c.gender,
          c.personality,
          c.philosophy_statement,
          c.tone,
          c.humor,
          c.friendliness,
          c.creativity,
          c.style,
          c.nicknames_for_user,
          c.catchphrases,
          c.speech_quirks,
          c.shared_memories_seed,
          c.backstory,
          c.interests,
          c.decision_frameworks,
          c.mental_models,
          c.tags,
          c.greeting,
          c.is_system,
          c.is_public,
          c.total_subscribers,
          c.is_verified,
          c.total_interactions,
          c.created_at,
          c.updated_at,
          c.is_sports_analyst,
          c.analysis_style,
          c.primary_leagues,
          c.risk_tier,
          (sub.id IS NOT NULL) AS is_subscribed,
          FALSE AS is_mind,
          (
            SELECT m.content
            FROM messages m
            JOIN conversations conv ON conv.id = m.conversation_id
            WHERE conv.character_id = c.id AND conv.user_id = ?
            ORDER BY m.id DESC
            LIMIT 1
          ) AS last_message,
          (
            SELECT m.created_at
            FROM messages m
            JOIN conversations conv ON conv.id = m.conversation_id
            WHERE conv.character_id = c.id AND conv.user_id = ?
            ORDER BY m.id DESC
            LIMIT 1
          ) AS last_message_at,
          (
            SELECT m.sender_type
            FROM messages m
            JOIN conversations conv ON conv.id = m.conversation_id
            WHERE conv.character_id = c.id AND conv.user_id = ?
            ORDER BY m.id DESC
            LIMIT 1
          ) AS last_message_sender,
          GREATEST(
            COALESCE(c.updated_at, c.created_at),
            COALESCE((
              SELECT MAX(m.created_at)
              FROM messages m
              JOIN conversations conv ON conv.id = m.conversation_id
              WHERE conv.character_id = c.id AND conv.user_id = ?
            ), c.created_at)
          ) AS sort_time
        FROM characters c
        LEFT JOIN mind_subscriptions sub ON sub.character_id = c.id AND sub.user_id = ?
        WHERE 
          c.user_id = ? 
          OR c.is_system = TRUE
          OR sub.id IS NOT NULL
          OR EXISTS (
            SELECT 1 
            FROM conversations conv 
            WHERE conv.character_id = c.id AND conv.user_id = ?
          )

        UNION ALL

        SELECT DISTINCT
          m.id AS id,
          m.user_id AS user_id,
          COALESCE(m.display_name, m.handle) AS name,
          m.handle AS handle,
          m.headline AS headline,
          'companion' AS relationship_type,
          m.avatar_url AS avatar_url,
          m.voice_provider AS voice_provider,
          m.voice_id AS voice_id,
          m.voice_sample_url AS voice_sample_url,
          m.voice_settings AS voice_settings,
          m.website_url AS website_url,
          'Mind' AS gender,
          COALESCE(m.bio, m.philosophy_statement) AS personality,
          m.philosophy_statement AS philosophy_statement,
          'Philosophical & Socratic' AS tone,
          5 AS humor,
          5 AS friendliness,
          5 AS creativity,
          'Direct & Conversational' AS style,
          '[]' AS nicknames_for_user,
          '[]' AS catchphrases,
          NULL AS speech_quirks,
          NULL AS shared_memories_seed,
          m.bio AS backstory,
          m.tags AS interests,
          m.decision_frameworks AS decision_frameworks,
          '[]' AS mental_models,
          m.tags AS tags,
          CONCAT('Hello! I am the AI Mind of ', COALESCE(m.display_name, m.handle), '. What would you like to explore today?') AS greeting,
          FALSE AS is_system,
          TRUE AS is_public,
          0 AS total_subscribers,
          TRUE AS is_verified,
          m.total_consultations AS total_interactions,
          m.created_at AS created_at,
          m.updated_at AS updated_at,
          FALSE AS is_sports_analyst,
          'quant_expected_value' AS analysis_style,
          '[]' AS primary_leagues,
          'balanced_quarter_kelly' AS risk_tier,
          TRUE AS is_subscribed,
          TRUE AS is_mind,
          (
            SELECT mcm.content
            FROM mind_consultation_messages mcm
            WHERE mcm.session_id = s.id
            ORDER BY mcm.id DESC
            LIMIT 1
          ) AS last_message,
          (
            SELECT mcm.created_at
            FROM mind_consultation_messages mcm
            WHERE mcm.session_id = s.id
            ORDER BY mcm.id DESC
            LIMIT 1
          ) AS last_message_at,
          (
            SELECT mcm.sender_type
            FROM mind_consultation_messages mcm
            WHERE mcm.session_id = s.id
            ORDER BY mcm.id DESC
            LIMIT 1
          ) AS last_message_sender,
          COALESCE(s.last_message_at, m.updated_at, m.created_at) AS sort_time
        FROM user_minds m
        JOIN mind_consultation_sessions s ON s.mind_id = m.id AND s.visitor_user_id = ?
      ) combined
      ORDER BY sort_time DESC
    `;

    const [rows] = await baseRepository.query(sql, [
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
      userId,
    ]);
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
      'is_sports_analyst', 'analysis_style', 'primary_leagues', 'risk_tier',
    ];

    const jsonFields = [
      'interests', 'nicknames_for_user', 'catchphrases', 'decision_frameworks',
      'mental_models', 'tags', 'voice_settings', 'primary_leagues',
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (jsonFields.includes(field)) {
          if (typeof updates[field] !== 'string') {
            values.push(JSON.stringify(updates[field]));
          } else {
            values.push(updates[field]);
          }
        } else if (field === 'is_public' || field === 'is_sports_analyst') {
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
      is_mind: Boolean(row.is_mind),
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
      is_sports_analyst: Boolean(row.is_sports_analyst),
      analysis_style: row.analysis_style || 'quant_expected_value',
      primary_leagues: parseJsonArray(row.primary_leagues),
      risk_tier: row.risk_tier || 'balanced_quarter_kelly',
      allow_proactive_checkins: row.allow_proactive_checkins !== undefined ? Boolean(row.allow_proactive_checkins) : true,
    };
  }

  /**
   * Update proactive check-in permission for a character.
   */
  async updateProactiveCheckins(characterId, userId, allow) {
    const sql = `
      UPDATE characters
      SET allow_proactive_checkins = ?
      WHERE id = ? AND (user_id = ? OR is_system = TRUE)
    `;
    await baseRepository.execute(sql, [allow ? 1 : 0, characterId, userId]);
    return await this.findById(characterId);
  }
}

export const characterRepository = new CharacterRepository();
export default characterRepository;
