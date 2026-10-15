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

  /**
   * Fetch recent visitor questions asked to a specific Mind across all consultation sessions.
   * Used by creators in My Mind Studio to see what their audience is asking and fill knowledge gaps.
   * @param {number|string} mindId
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  async findAudienceQuestionsByMindId(mindId, limit = 20) {
    try {
      const [rows] = await baseRepository.query(
        `SELECT m.id,
                m.content AS question,
                m.created_at,
                (
                  SELECT m2.content
                  FROM mind_consultation_messages m2
                  WHERE m2.session_id = m.session_id
                    AND m2.sender_type = 'mind'
                    AND m2.id > m.id
                  ORDER BY m2.id ASC
                  LIMIT 1
                ) AS mind_reply,
                EXISTS(
                  SELECT 1
                  FROM mind_sources s
                  WHERE s.mind_id = ?
                    AND s.title = CONCAT('Q&A: ', SUBSTRING(m.content, 1, 120))
                ) AS is_trained
         FROM mind_consultation_messages m
         INNER JOIN mind_consultation_sessions cs ON m.session_id = cs.id
         WHERE cs.mind_id = ?
           AND m.sender_type = 'user'
           AND CHAR_LENGTH(TRIM(m.content)) > 5
           AND m.content NOT LIKE '🎤%'
         ORDER BY m.created_at DESC
         LIMIT ?`,
        [mindId, mindId, limit]
      );
      return rows.map((r) => ({
        id: r.id,
        question: r.question,
        mind_reply: r.mind_reply || null,
        created_at: r.created_at,
        is_trained: Boolean(r.is_trained),
      }));
    } catch (err) {
      console.warn('[MIND_KNOWLEDGE] Error fetching audience questions:', err.message);
      return [];
    }
  }

  /**
   * Fetch a consultation session by ID.
   */
  async findConsultationSessionById(sessionId) {
    const [rows] = await baseRepository.query(
      'SELECT * FROM mind_consultation_sessions WHERE id = ? LIMIT 1',
      [sessionId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Unlock Paid Direct Human Chat on a visitor's consultation session.
   */
  async unlockDirectHumanChat(sessionId, { paidAmount = 25, handoffSummary = '', escalationNote = '' }) {
    await baseRepository.execute(
      `UPDATE mind_consultation_sessions
       SET is_paid_unlocked = 1,
           chat_mode = 'human_direct',
           paid_amount = ?,
           handoff_summary = ?,
           escalation_note = ?,
           unread_for_creator = unread_for_creator + 1,
           escalated_at = COALESCE(escalated_at, CURRENT_TIMESTAMP),
           last_message_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [Number(paidAmount) || 25, handoffSummary || null, escalationNote || null, sessionId]
    );
    return await this.findConsultationSessionById(sessionId);
  }

  /**
   * Switch chat_mode ('ai' | 'human_direct') on an unlocked consultation session.
   */
  async setSessionChatMode(sessionId, chatMode) {
    const safeMode = chatMode === 'human_direct' ? 'human_direct' : 'ai';
    await baseRepository.execute(
      `UPDATE mind_consultation_sessions SET chat_mode = ? WHERE id = ?`,
      [safeMode, sessionId]
    );
    return await this.findConsultationSessionById(sessionId);
  }

  /**
   * Increment unread count for the creator when a visitor messages in human_direct mode.
   */
  async incrementUnreadForCreator(sessionId) {
    await baseRepository.execute(
      `UPDATE mind_consultation_sessions
       SET unread_for_creator = unread_for_creator + 1,
           last_message_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [sessionId]
    );
  }

  /**
   * Mark a paid session as read by the creator.
   */
  async markCreatorSessionRead(sessionId) {
    await baseRepository.execute(
      `UPDATE mind_consultation_sessions SET unread_for_creator = 0 WHERE id = ?`,
      [sessionId]
    );
  }

  /**
   * Fetch all paid direct human sessions for a Mind (Creator VIP Inbox),
   * including visitor info, AI handoff brief, and recent conversation messages.
   */
  async findPaidHumanSessionsByMindId(mindId) {
    try {
      const [sessions] = await baseRepository.query(
        `SELECT cs.*, u.email AS visitor_email
         FROM mind_consultation_sessions cs
         LEFT JOIN users u ON cs.visitor_user_id = u.id
         WHERE cs.mind_id = ? AND cs.is_paid_unlocked = 1
         ORDER BY cs.unread_for_creator DESC, cs.last_message_at DESC`,
        [mindId]
      );

      const enriched = [];
      for (const s of sessions) {
        const messages = await this.findRecentConsultationMessages(s.id, 40);
        enriched.push({
          id: s.id,
          mind_id: s.mind_id,
          visitor_user_id: s.visitor_user_id,
          visitor_email: s.visitor_email || `Visitor #${s.visitor_user_id || s.id}`,
          visitor_name: s.visitor_email ? s.visitor_email.split('@')[0] : `Visitor #${s.visitor_user_id || s.id}`,
          title: s.title,
          chat_mode: s.chat_mode || 'human_direct',
          is_paid_unlocked: Boolean(s.is_paid_unlocked),
          paid_amount: Number(s.paid_amount || 25),
          handoff_summary: s.handoff_summary || null,
          escalation_note: s.escalation_note || null,
          unread_for_creator: Number(s.unread_for_creator || 0),
          escalated_at: s.escalated_at || s.created_at,
          last_message_at: s.last_message_at,
          messages,
        });
      }
      return enriched;
    } catch (err) {
      console.warn('[MIND_KNOWLEDGE] Error fetching paid human sessions:', err.message);
      return [];
    }
  }
}

export const mindKnowledgeRepository = new MindKnowledgeRepository();
export default mindKnowledgeRepository;
