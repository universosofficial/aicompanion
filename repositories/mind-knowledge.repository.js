import baseRepository from './base.repository.js';

/**
 * MindKnowledgeRepository
 * Database access layer for Mind training sources, chunked knowledge nodes,
 * and visitor consultation sessions.
 */
export class MindKnowledgeRepository {
  /**
   * Create an ingestion source record for a Mind.
   * @param {Object} params
   * @param {number|string} params.mindId
   * @param {'url'|'pdf'|'document'|'manual_text'} params.sourceType
   * @param {string} params.title
   * @param {string|null} [params.sourceUri]
   * @param {'pending'|'processing'|'indexed'|'failed'} [params.status='pending']
   * @returns {Promise<Object>} Created source record
   */
  async createSource({ mindId, sourceType, title, sourceUri = null, status = 'pending' }) {
    const res = await baseRepository.execute(
      `INSERT INTO mind_sources (mind_id, source_type, title, source_uri, status)
       VALUES (?, ?, ?, ?, ?)`,
      [mindId, sourceType, title, sourceUri, status]
    );

    return await this.findSourceById(res.insertId);
  }

  /**
   * Find a source by ID.
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async findSourceById(id) {
    const [rows] = await baseRepository.query(
      'SELECT * FROM mind_sources WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find all sources belonging to a specific Mind.
   * @param {number|string} mindId
   * @returns {Promise<Array>}
   */
  async findSourcesByMindId(mindId) {
    const [rows] = await baseRepository.query(
      'SELECT * FROM mind_sources WHERE mind_id = ? ORDER BY created_at DESC',
      [mindId]
    );
    return rows;
  }

  /**
   * Update the status and chunk metrics of a source.
   * @param {number|string} sourceId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async updateSourceStatus(sourceId, { status, chunkCount, errorMessage = null }) {
    const setClauses = ['status = ?'];
    const params = [status];

    if (chunkCount !== undefined) {
      setClauses.push('chunk_count = ?');
      params.push(chunkCount);
    }

    if (errorMessage !== undefined) {
      setClauses.push('error_message = ?');
      params.push(errorMessage);
    }

    params.push(sourceId);

    await baseRepository.execute(
      `UPDATE mind_sources SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  }

  /**
   * Delete a source and cascade delete all its chunks.
   * @param {number|string} sourceId
   * @param {number|string} [mindId] - Optional validation against mindId
   * @returns {Promise<boolean>}
   */
  async deleteSource(sourceId, mindId = null) {
    let sql = 'DELETE FROM mind_sources WHERE id = ?';
    const params = [sourceId];
    if (mindId) {
      sql += ' AND mind_id = ?';
      params.push(mindId);
    }

    const res = await baseRepository.execute(sql, params);
    return res.affectedRows > 0;
  }

  /**
   * Bulk insert text chunks into mind_knowledge_nodes.
   * @param {number|string} mindId
   * @param {number|string} sourceId
   * @param {Array<{ title: string, topic?: string, content: string }>} chunks
   * @returns {Promise<number>} Number of inserted chunks
   */
  async insertKnowledgeChunks(mindId, sourceId, chunks) {
    if (!chunks || chunks.length === 0) return 0;

    const placeholders = chunks.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = [];

    for (const chunk of chunks) {
      params.push(
        mindId,
        sourceId,
        chunk.title || 'Untitled Node',
        chunk.topic || 'general',
        chunk.content
      );
    }

    const sql = `
      INSERT INTO mind_knowledge_nodes (mind_id, source_id, title, topic, content)
      VALUES ${placeholders}
    `;

    const res = await baseRepository.execute(sql, params);
    return res.affectedRows || chunks.length;
  }

  /**
   * Search and retrieve top matching knowledge nodes for a query.
   * Uses MySQL Full-Text search with semantic keyword fallback.
   * @param {number|string} mindId
   * @param {string} queryText
   * @param {number} [limit=5]
   * @returns {Promise<Array>}
   */
  async findRelevantKnowledge(mindId, queryText, limit = 5) {
    if (!queryText || !queryText.trim()) return [];

    const cleanQuery = queryText.trim();

    // 1. Natural Language Full-Text Search
    const ftSql = `
      SELECT k.id, k.mind_id, k.source_id, k.title, k.topic, k.content,
             s.title AS source_title, s.source_type,
             MATCH(k.title, k.content) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
      FROM mind_knowledge_nodes k
      LEFT JOIN mind_sources s ON k.source_id = s.id
      WHERE k.mind_id = ?
        AND MATCH(k.title, k.content) AGAINST(? IN NATURAL LANGUAGE MODE) > 0.05
      ORDER BY score DESC
      LIMIT ?
    `;

    try {
      const [ftRows] = await baseRepository.query(ftSql, [cleanQuery, mindId, cleanQuery, limit]);
      if (ftRows && ftRows.length > 0) {
        return ftRows;
      }
    } catch (err) {
      console.warn('[KNOWLEDGE SEARCH FT FAILED, FALLING BACK TO LIKE]', err.message);
    }

    // 2. Keyword fallback
    const keywords = cleanQuery
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 4);

    if (keywords.length === 0) {
      const [fallbackRows] = await baseRepository.query(
        `SELECT k.id, k.mind_id, k.source_id, k.title, k.topic, k.content,
                s.title AS source_title, s.source_type, 1.0 AS score
         FROM mind_knowledge_nodes k
         LEFT JOIN mind_sources s ON k.source_id = s.id
         WHERE k.mind_id = ?
         LIMIT ?`,
        [mindId, limit]
      );
      return fallbackRows;
    }

    const likeConditions = keywords.map(() => '(k.content LIKE ? OR k.title LIKE ?)').join(' OR ');
    const likeParams = [mindId];
    keywords.forEach((w) => {
      likeParams.push(`%${w}%`, `%${w}%`);
    });
    likeParams.push(limit);

    const fallbackSql = `
      SELECT k.id, k.mind_id, k.source_id, k.title, k.topic, k.content,
             s.title AS source_title, s.source_type, 1.0 AS score
      FROM mind_knowledge_nodes k
      LEFT JOIN mind_sources s ON k.source_id = s.id
      WHERE k.mind_id = ? AND (${likeConditions})
      LIMIT ?
    `;

    const [rows] = await baseRepository.query(fallbackSql, likeParams);
    return rows;
  }

  // --- Visitor Consultation Sessions & Messages ---

  /**
   * Find or create active consultation session between visitor and a public Mind.
   * @param {number|string} visitorUserId
   * @param {number|string} mindId
   * @param {string} [title='Consultation']
   * @returns {Promise<Object>}
   */
  async findOrCreateConsultationSession(visitorUserId, mindId, title = 'Consultation') {
    const [existing] = await baseRepository.query(
      `SELECT * FROM mind_consultation_sessions
       WHERE visitor_user_id = ? AND mind_id = ?
       ORDER BY last_message_at DESC LIMIT 1`,
      [visitorUserId, mindId]
    );

    if (existing.length > 0) {
      return existing[0];
    }

    const res = await baseRepository.execute(
      `INSERT INTO mind_consultation_sessions (visitor_user_id, mind_id, title)
       VALUES (?, ?, ?)`,
      [visitorUserId, mindId, title]
    );

    const [created] = await baseRepository.query(
      'SELECT * FROM mind_consultation_sessions WHERE id = ? LIMIT 1',
      [res.insertId]
    );
    return created[0];
  }

  /**
   * Fetch recent consultation messages in a session.
   * @param {number|string} sessionId
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async findRecentConsultationMessages(sessionId, limit = 10) {
    const [rows] = await baseRepository.query(
      `SELECT * FROM (
         SELECT id, session_id, sender_type, message_type, content, audio_url, duration_seconds, created_at
         FROM mind_consultation_messages
         WHERE session_id = ?
         ORDER BY id DESC
         LIMIT ?
       ) sub ORDER BY id ASC`,
      [sessionId, limit]
    );
    return rows;
  }

  /**
   * Save a consultation message and update session last_message_at.
   * @param {number|string} sessionId
   * @param {'user'|'mind'} senderType
   * @param {string} content
   * @param {'text'|'voice'} [messageType='text']
   * @param {string|null} [audioUrl=null]
   * @param {number|null} [durationSeconds=null]
   * @returns {Promise<Object>}
   */
  async createConsultationMessage(sessionId, senderType, content, messageType = 'text', audioUrl = null, durationSeconds = null) {
    const res = await baseRepository.execute(
      `INSERT INTO mind_consultation_messages (session_id, sender_type, message_type, content, audio_url, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, senderType, messageType, content, audioUrl, durationSeconds]
    );

    await baseRepository.execute(
      'UPDATE mind_consultation_sessions SET last_message_at = CURRENT_TIMESTAMP WHERE id = ?',
      [sessionId]
    );

    const [created] = await baseRepository.query(
      'SELECT * FROM mind_consultation_messages WHERE id = ? LIMIT 1',
      [res.insertId]
    );
    return created[0];
  }
}

export const mindKnowledgeRepository = new MindKnowledgeRepository();
export default mindKnowledgeRepository;
