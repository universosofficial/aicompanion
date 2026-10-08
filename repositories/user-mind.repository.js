import baseRepository from './base.repository.js';

/**
 * UserMindRepository
 * Database access layer for the User's single 1:1 Digital Twin AI Mind.
 */
export class UserMindRepository {
  /**
   * Helper to format mind row from database (parsing JSON fields)
   */
  formatMind(row) {
    if (!row) return null;
    let frameworks = [];
    if (row.decision_frameworks) {
      if (Array.isArray(row.decision_frameworks)) {
        frameworks = row.decision_frameworks;
      } else if (typeof row.decision_frameworks === 'string') {
        try {
          frameworks = JSON.parse(row.decision_frameworks);
        } catch {
          frameworks = [row.decision_frameworks];
        }
      }
    }

    let tags = [];
    if (row.tags) {
      if (Array.isArray(row.tags)) {
        tags = row.tags;
      } else if (typeof row.tags === 'string') {
        try {
          tags = JSON.parse(row.tags);
        } catch {
          tags = [row.tags];
        }
      }
    }

    let voiceSettings = {};
    if (row.voice_settings) {
      if (typeof row.voice_settings === 'string') {
        try { voiceSettings = JSON.parse(row.voice_settings); } catch { voiceSettings = {}; }
      } else if (typeof row.voice_settings === 'object') {
        voiceSettings = row.voice_settings;
      }
    }

    return {
      ...row,
      is_published: Boolean(row.is_published),
      decision_frameworks: frameworks,
      tags,
      voice_provider: row.voice_provider || 'preset',
      voice_id: row.voice_id || 'echo',
      voice_sample_url: row.voice_sample_url || null,
      voice_settings: voiceSettings,
    };
  }

  /**
   * Fetch the authenticated user's single Mind (or null if not created).
   * @param {number|string} userId
   * @returns {Promise<Object|null>}
   */
  async findByUserId(userId) {
    const [rows] = await baseRepository.query(
      'SELECT * FROM user_minds WHERE user_id = ? LIMIT 1',
      [userId]
    );
    return rows.length > 0 ? this.formatMind(rows[0]) : null;
  }

  /**
   * Fetch a public Mind by its unique handle (@handle).
   * @param {string} handle
   * @returns {Promise<Object|null>}
   */
  async findByHandle(handle) {
    const cleanHandle = String(handle).replace(/^@/, '').trim();
    const [rows] = await baseRepository.query(
      'SELECT * FROM user_minds WHERE handle = ? LIMIT 1',
      [cleanHandle]
    );
    return rows.length > 0 ? this.formatMind(rows[0]) : null;
  }

  /**
   * Fetch a Mind by its internal ID.
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    const [rows] = await baseRepository.query(
      'SELECT * FROM user_minds WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length > 0 ? this.formatMind(rows[0]) : null;
  }

  /**
   * Upsert the user's single 1:1 Mind profile.
   * Enforces 1:1 relationship with users and handle uniqueness.
   * @param {number|string} userId
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async upsert(userId, data) {
    const existing = await this.findByUserId(userId);
    const cleanHandle = data.handle ? String(data.handle).replace(/^@/, '').trim().toLowerCase() : null;

    // Check if handle is already claimed by another mind
    if (cleanHandle) {
      const [handleClash] = await baseRepository.query(
        'SELECT id FROM user_minds WHERE handle = ? AND user_id != ? LIMIT 1',
        [cleanHandle, userId]
      );
      if (handleClash.length > 0) {
        const err = new Error(`The handle @${cleanHandle} is already claimed by another user.`);
        err.statusCode = 409;
        err.code = 'HANDLE_TAKEN';
        throw err;
      }
    }

    const frameworksJson = data.decision_frameworks !== undefined
      ? JSON.stringify(data.decision_frameworks || [])
      : null;
    const tagsJson = data.tags !== undefined
      ? JSON.stringify(data.tags || [])
      : null;

    if (existing) {
      // Update existing 1:1 mind
      const updates = [];
      const params = [];

      if (cleanHandle !== null) {
        updates.push('handle = ?');
        params.push(cleanHandle);
      }
      if (data.display_name !== undefined) {
        updates.push('display_name = ?');
        params.push(data.display_name);
      }
      if (data.headline !== undefined) {
        updates.push('headline = ?');
        params.push(data.headline);
      }
      if (data.avatar_url !== undefined) {
        updates.push('avatar_url = ?');
        params.push(data.avatar_url);
      }
      if (data.website_url !== undefined) {
        updates.push('website_url = ?');
        params.push(data.website_url);
      }
      if (data.bio !== undefined) {
        updates.push('bio = ?');
        params.push(data.bio);
      }
      if (data.philosophy_statement !== undefined) {
        updates.push('philosophy_statement = ?');
        params.push(data.philosophy_statement);
      }
      if (frameworksJson !== null) {
        updates.push('decision_frameworks = ?');
        params.push(frameworksJson);
      }
      if (tagsJson !== null) {
        updates.push('tags = ?');
        params.push(tagsJson);
      }
      if (data.voice_provider !== undefined) {
        updates.push('voice_provider = ?');
        params.push(data.voice_provider);
      }
      if (data.voice_id !== undefined) {
        updates.push('voice_id = ?');
        params.push(data.voice_id);
      }
      if (data.voice_sample_url !== undefined) {
        updates.push('voice_sample_url = ?');
        params.push(data.voice_sample_url);
      }
      if (data.voice_settings !== undefined) {
        updates.push('voice_settings = ?');
        params.push(typeof data.voice_settings === 'object' ? JSON.stringify(data.voice_settings) : data.voice_settings);
      }
      if (data.is_published !== undefined) {
        updates.push('is_published = ?');
        params.push(Boolean(data.is_published));
      }

      if (updates.length > 0) {
        params.push(userId);
        await baseRepository.execute(
          `UPDATE user_minds SET ${updates.join(', ')} WHERE user_id = ?`,
          params
        );
      }

      return await this.findByUserId(userId);
    } else {
      // Create new 1:1 mind
      const defaultHandle = cleanHandle || `user_${userId}`;
      const displayName = data.display_name || `Mind of ${defaultHandle}`;
      const voiceSettingsJson = data.voice_settings
        ? (typeof data.voice_settings === 'object' ? JSON.stringify(data.voice_settings) : data.voice_settings)
        : null;

      const res = await baseRepository.execute(
        `INSERT INTO user_minds (
          user_id, handle, display_name, headline, avatar_url, voice_provider, voice_id, voice_sample_url, voice_settings,
          website_url, bio, philosophy_statement, decision_frameworks, tags, is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          defaultHandle,
          displayName,
          data.headline || null,
          data.avatar_url || null,
          data.voice_provider || 'preset',
          data.voice_id || 'echo',
          data.voice_sample_url || null,
          voiceSettingsJson,
          data.website_url || null,
          data.bio || null,
          data.philosophy_statement || null,
          frameworksJson || JSON.stringify([]),
          tagsJson || JSON.stringify([]),
          Boolean(data.is_published),
        ]
      );

      return await this.findById(res.insertId);
    }
  }

  /**
   * Search public minds in the Mind Commons directory.
   * @param {Object} params
   * @param {string} [params.query]
   * @param {string} [params.tag]
   * @param {number} [params.page=1]
   * @param {number} [params.limit=20]
   * @returns {Promise<{ minds: Array, total: number, page: number, totalPages: number }>}
   */
  async searchMinds({ query = '', tag = '', page = 1, limit = 20 } = {}) {
    const conditions = ['is_published = TRUE'];
    const values = [];

    if (tag && tag.trim()) {
      const cleanTag = tag.trim().replace(/^#/, '');
      conditions.push('JSON_SEARCH(tags, "one", ?) IS NOT NULL');
      values.push(cleanTag);
    }

    if (query && query.trim()) {
      const term = query.trim();
      const likeTerm = `%${term}%`;
      conditions.push(`(
        MATCH(display_name, handle, headline, philosophy_statement) AGAINST(? IN NATURAL LANGUAGE MODE)
        OR display_name LIKE ?
        OR handle LIKE ?
        OR headline LIKE ?
        OR JSON_SEARCH(tags, "one", ?) IS NOT NULL
      )`);
      values.push(term, likeTerm, likeTerm, likeTerm, term);
    }

    const offset = Math.max(0, (page - 1) * limit);

    // Count matching
    const countSql = `SELECT COUNT(*) as total FROM user_minds WHERE ${conditions.join(' AND ')}`;
    const [countRows] = await baseRepository.query(countSql, values);
    const total = countRows[0]?.total || 0;

    // Fetch paginated
    const selectSql = `
      SELECT id, user_id, handle, display_name, headline, avatar_url, voice_provider, voice_id, voice_sample_url, voice_settings,
             website_url, bio, philosophy_statement, decision_frameworks, tags, is_published,
             total_consultations, created_at, updated_at
      FROM user_minds
      WHERE ${conditions.join(' AND ')}
      ORDER BY total_consultations DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await baseRepository.query(selectSql, [...values, limit, offset]);

    return {
      minds: rows.map((r) => this.formatMind(r)),
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Atomically increment total consultation interactions for a Mind.
   * @param {number|string} mindId
   */
  async incrementConsultations(mindId) {
    await baseRepository.execute(
      'UPDATE user_minds SET total_consultations = total_consultations + 1 WHERE id = ?',
      [mindId]
    );
  }
}

export const userMindRepository = new UserMindRepository();
export default userMindRepository;
