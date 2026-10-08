import baseRepository from './base.repository.js';
import characterRepository from './character.repository.js';

/**
 * MindRepository
 * Database access layer for Public Minds, Discovery, Subscriptions, Knowledge Nodes, and Interactions.
 */
export class MindRepository {
  /**
   * Search and filter public minds in the Mind Commons / Discovery Hub.
   * @param {Object} params
   * @param {string} [params.query] - Keyword or fulltext search string
   * @param {string} [params.tag] - Filter by specific tag
   * @param {string} [params.sort='popular'] - 'popular' | 'newest' | 'name'
   * @param {number} [params.page=1]
   * @param {number} [params.limit=20]
   * @param {number|null} [params.userId=null] - Requesting user ID for subscription checks
   * @returns {Promise<{ minds: Array, total: number, page: number, totalPages: number }>}
   */
  async searchMinds({ query = '', tag = '', sort = 'popular', page = 1, limit = 20, userId = null } = {}) {
    const conditions = ['c.is_public = TRUE'];
    const values = [];

    // Filter by tag if provided
    if (tag && tag.trim()) {
      const cleanTag = tag.trim().replace(/^#/, '');
      conditions.push('JSON_SEARCH(c.tags, "one", ?) IS NOT NULL');
      values.push(cleanTag);
    }

    // Keyword / Fulltext search
    if (query && query.trim()) {
      const term = query.trim();
      const likeTerm = `%${term}%`;
      conditions.push(`(
        MATCH(c.name, c.headline, c.personality, c.philosophy_statement) AGAINST(? IN NATURAL LANGUAGE MODE)
        OR c.name LIKE ?
        OR c.headline LIKE ?
        OR c.handle LIKE ?
        OR JSON_SEARCH(c.tags, "one", ?) IS NOT NULL
      )`);
      values.push(term, likeTerm, likeTerm, likeTerm, term);
    }

    // Determine Sort Order
    let orderBy = 'c.is_verified DESC, c.total_subscribers DESC, c.total_interactions DESC, c.created_at DESC';
    if (sort === 'newest') {
      orderBy = 'c.created_at DESC';
    } else if (sort === 'name') {
      orderBy = 'c.name ASC';
    } else if (sort === 'popular') {
      orderBy = 'c.total_subscribers DESC, c.total_interactions DESC';
    }

    const offset = Math.max(0, (page - 1) * limit);

    // 1. Get total matching count
    const countSql = `
      SELECT COUNT(*) as total
      FROM characters c
      WHERE ${conditions.join(' AND ')}
    `;
    const countRow = await baseRepository.queryOne(countSql, values);
    const total = countRow ? Number(countRow.total) : 0;

    // 2. Fetch paginated records with safe creator info and user subscription status
    const dataSql = `
      SELECT 
        c.*,
        u.email as creator_email,
        ${userId ? '(sub.id IS NOT NULL)' : 'FALSE'} AS is_subscribed
      FROM characters c
      LEFT JOIN users u ON c.user_id = u.id
      ${userId ? 'LEFT JOIN mind_subscriptions sub ON sub.character_id = c.id AND sub.user_id = ?' : ''}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const dataParams = userId ? [userId, ...values, Number(limit), offset] : [...values, Number(limit), offset];
    const [rows] = await baseRepository.query(dataSql, dataParams);

    const minds = rows.map((r) => this.formatPublicMind(r));

    return {
      minds,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Find a public mind by unique handle.
   * @param {string} handle - Handle with or without leading '@'
   * @param {number|null} [userId=null]
   * @returns {Promise<Object|null>}
   */
  async findByHandle(handle, userId = null) {
    if (!handle) return null;
    const cleanHandle = String(handle).replace(/^@/, '').toLowerCase().trim();

    const sql = `
      SELECT 
        c.*,
        u.email as creator_email,
        ${userId ? '(sub.id IS NOT NULL)' : 'FALSE'} AS is_subscribed
      FROM characters c
      LEFT JOIN users u ON c.user_id = u.id
      ${userId ? 'LEFT JOIN mind_subscriptions sub ON sub.character_id = c.id AND sub.user_id = ?' : ''}
      WHERE LOWER(c.handle) = LOWER(?) AND c.is_public = TRUE
      LIMIT 1
    `;

    const params = userId ? [userId, cleanHandle] : [cleanHandle];
    const row = await baseRepository.queryOne(sql, params);
    return row ? this.formatPublicMind(row) : null;
  }

  /**
   * Find a public mind by character ID.
   */
  async findById(characterId, userId = null) {
    const sql = `
      SELECT 
        c.*,
        u.email as creator_email,
        ${userId ? '(sub.id IS NOT NULL)' : 'FALSE'} AS is_subscribed
      FROM characters c
      LEFT JOIN users u ON c.user_id = u.id
      ${userId ? 'LEFT JOIN mind_subscriptions sub ON sub.character_id = c.id AND sub.user_id = ?' : ''}
      WHERE c.id = ?
      LIMIT 1
    `;

    const params = userId ? [userId, characterId] : [characterId];
    const row = await baseRepository.queryOne(sql, params);
    return row ? this.formatPublicMind(row) : null;
  }

  /**
   * Check if a handle is available or claimed.
   */
  async isHandleAvailable(handle, excludeCharacterId = null) {
    if (!handle) return false;
    const cleanHandle = String(handle).replace(/^@/, '').toLowerCase().trim();

    let sql = 'SELECT id FROM characters WHERE LOWER(handle) = LOWER(?)';
    const values = [cleanHandle];

    if (excludeCharacterId) {
      sql += ' AND id != ?';
      values.push(excludeCharacterId);
    }

    const row = await baseRepository.queryOne(sql, values);
    return !row;
  }

  /**
   * Subscribe user to a public mind ("Add to My Minds").
   */
  async subscribeUser(userId, characterId) {
    const insertSql = `
      INSERT INTO mind_subscriptions (user_id, character_id)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE id=id
    `;
    const res = await baseRepository.execute(insertSql, [userId, characterId]);
    if (res.affectedRows > 0) {
      await baseRepository.execute(`
        UPDATE characters
        SET total_subscribers = total_subscribers + 1
        WHERE id = ?
      `, [characterId]);
    }
    return true;
  }

  /**
   * Unsubscribe user from a public mind.
   */
  async unsubscribeUser(userId, characterId) {
    const deleteSql = `
      DELETE FROM mind_subscriptions
      WHERE user_id = ? AND character_id = ?
    `;
    const res = await baseRepository.execute(deleteSql, [userId, characterId]);
    if (res.affectedRows > 0) {
      await baseRepository.execute(`
        UPDATE characters
        SET total_subscribers = GREATEST(0, CAST(total_subscribers AS SIGNED) - 1)
        WHERE id = ?
      `, [characterId]);
    }
    return true;
  }

  /**
   * Check if a user is subscribed to a character.
   */
  async isSubscribed(userId, characterId) {
    if (!userId) return false;
    const sql = `
      SELECT id FROM mind_subscriptions
      WHERE user_id = ? AND character_id = ?
      LIMIT 1
    `;
    const row = await baseRepository.queryOne(sql, [userId, characterId]);
    return Boolean(row);
  }

  /**
   * Get all public minds a user has subscribed to.
   */
  async getSubscriptionsByUserId(userId) {
    const sql = `
      SELECT 
        c.*,
        u.email as creator_email,
        TRUE AS is_subscribed
      FROM mind_subscriptions s
      JOIN characters c ON s.character_id = c.id
      LEFT JOIN users u ON c.user_id = u.id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC
    `;
    const [rows] = await baseRepository.query(sql, [userId]);
    return rows.map((r) => this.formatPublicMind(r));
  }

  /**
   * Atomically increment total consultation interactions for a mind.
   */
  async incrementInteractions(mindId) {
    const sql = `
      UPDATE characters
      SET total_interactions = total_interactions + 1
      WHERE id = ?
    `;
    await baseRepository.execute(sql, [mindId]);
  }

  /**
   * Record a consultation session between a visitor and a public mind.
   */
  async recordVisitorSession(visitorUserId, mindId) {
    const sql = `
      INSERT INTO mind_visitor_sessions (visitor_user_id, mind_id)
      VALUES (?, ?)
    `;
    await baseRepository.execute(sql, [visitorUserId, mindId]);
  }

  /**
   * Bulk insert chunked knowledge nodes for a character/source.
   * Supports both (chunksArray) or (characterId, sourceId, chunksArray)
   */
  async insertKnowledgeChunks(arg1, arg2, arg3) {
    let chunks = [];
    if (Array.isArray(arg1)) {
      chunks = arg1;
    } else if (Array.isArray(arg3)) {
      const characterId = arg1;
      const sourceId = arg2;
      chunks = arg3.map((c) => ({
        characterId,
        sourceId,
        title: c.title,
        topic: c.topic,
        content: c.content,
        chunkIndex: c.chunkIndex,
      }));
    }

    if (!Array.isArray(chunks) || chunks.length === 0) return 0;

    const rowPlaceholders = chunks.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const sql = `
      INSERT INTO mind_knowledge_nodes (character_id, source_id, title, topic, content, chunk_index)
      VALUES ${rowPlaceholders}
    `;

    const flatValues = [];
    for (const c of chunks) {
      flatValues.push(
        c.characterId,
        c.sourceId || null,
        c.title || 'Knowledge Chunk',
        c.topic || 'general',
        c.content,
        c.chunkIndex || 0
      );
    }

    const result = await baseRepository.execute(sql, flatValues);
    return result.affectedRows || chunks.length;
  }

  /**
   * Retrieve relevant knowledge chunks matching a query.
   * Employs full-text search with natural fallback to semantic keyword match.
   */
  async findRelevantKnowledge(characterId, queryText, limit = 4) {
    if (!characterId || !queryText || !queryText.trim()) return [];

    const cleanQuery = queryText.trim();

    // 1. Try Full-Text search first
    const ftSql = `
      SELECT 
        id, character_id, source_id, title, topic, content, chunk_index,
        MATCH(title, content) AGAINST(? IN NATURAL LANGUAGE MODE) AS relevance
      FROM mind_knowledge_nodes
      WHERE character_id = ? AND MATCH(title, content) AGAINST(? IN NATURAL LANGUAGE MODE)
      ORDER BY relevance DESC
      LIMIT ?
    `;

    try {
      const [ftRows] = await baseRepository.query(ftSql, [cleanQuery, characterId, cleanQuery, limit]);
      if (ftRows && ftRows.length > 0) {
        return ftRows;
      }
    } catch {
      // If fulltext index is unavailable or fails, fallback to keyword search
    }

    // 2. Keyword Substring Fallback
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'in', 'to', 'for', 'of', 'or', 'how', 'what', 'why']);
    const keywords = cleanQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 5);

    if (keywords.length === 0) {
      // Just return recent chunks for this character
      const recentSql = `
        SELECT id, character_id, source_id, title, topic, content, chunk_index
        FROM mind_knowledge_nodes
        WHERE character_id = ?
        ORDER BY id DESC
        LIMIT ?
      `;
      const [recentRows] = await baseRepository.query(recentSql, [characterId, limit]);
      return recentRows || [];
    }

    const likeConditions = keywords.map(() => '(content LIKE ? OR title LIKE ?)').join(' OR ');
    const likeValues = [];
    for (const kw of keywords) {
      likeValues.push(`%${kw}%`, `%${kw}%`);
    }

    const fallbackSql = `
      SELECT id, character_id, source_id, title, topic, content, chunk_index
      FROM mind_knowledge_nodes
      WHERE character_id = ? AND (${likeConditions})
      ORDER BY id DESC
      LIMIT ?
    `;

    const [fallbackRows] = await baseRepository.query(fallbackSql, [characterId, ...likeValues, limit]);
    return fallbackRows || [];
  }

  /**
   * Format public mind entity with safe creator details.
   */
  formatPublicMind(row) {
    if (!row) return null;

    const base = characterRepository.formatCharacter(row);

    const creatorName = row.creator_email
      ? row.creator_email.split('@')[0]
      : 'Anonymous Author';

    return {
      ...base,
      creator: {
        id: row.user_id,
        name: creatorName,
      },
    };
  }
}

export const mindRepository = new MindRepository();
export default mindRepository;
