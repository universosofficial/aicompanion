import baseRepository from './base.repository.js';

/**
 * MessageRepository
 * Database access layer for persisted chat messages.
 */
export class MessageRepository {
  /**
   * Persist a new message to the database.
   * @param {Object} params
   * @param {number|string} params.conversationId
   * @param {'user'|'assistant'|'system'} params.senderType
   * @param {string} params.content
   * @param {number} [params.tokenCount=0]
   * @returns {Promise<Object>} Created message record
   */
  async create({
    conversationId,
    senderType,
    content,
    tokenCount = 0,
    messageType = 'text',
    audioUrl = null,
    durationSeconds = null,
  }) {
    const sql = `
      INSERT INTO messages (conversation_id, sender_type, message_type, content, audio_url, duration_seconds, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await baseRepository.execute(sql, [
      conversationId,
      senderType,
      messageType,
      content,
      audioUrl,
      durationSeconds,
      tokenCount,
    ]);

    return {
      id: result.insertId,
      conversation_id: conversationId,
      sender_type: senderType,
      message_type: messageType,
      content,
      audio_url: audioUrl,
      duration_seconds: durationSeconds,
      token_count: tokenCount,
      created_at: new Date().toISOString(),
    };
  }

  /**
   * Fetch recent messages for a conversation in chronological order.
   * @param {number|string} conversationId
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async findRecentByConversationId(conversationId, limit = 10) {
    // Subquery retrieves the most recent `limit` messages, then orders them chronologically (ASC)
    const sql = `
      SELECT id, conversation_id, sender_type, message_type, content, audio_url, duration_seconds, token_count, created_at
      FROM (
        SELECT id, conversation_id, sender_type, message_type, content, audio_url, duration_seconds, token_count, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      ) AS recent_messages
      ORDER BY created_at ASC, id ASC
    `;

    const [rows] = await baseRepository.query(sql, [conversationId, parseInt(limit, 10)]);
    return rows;
  }

  /**
   * Count messages newer than the last summary checkpoint.
   * @param {number|string} conversationId
   * @param {number|string} [lastCondensedMessageId=0]
   * @returns {Promise<number>}
   */
  async countUnsummarized(conversationId, lastCondensedMessageId = 0) {
    const sql = `
      SELECT COUNT(*) AS total
      FROM messages
      WHERE conversation_id = ? AND id > ?
    `;
    const row = await baseRepository.queryOne(sql, [conversationId, lastCondensedMessageId || 0]);
    return row ? parseInt(row.total, 10) : 0;
  }

  /**
   * Retrieve messages newer than the last checkpoint to be condensed.
   * @param {number|string} conversationId
   * @param {number|string} [lastCondensedMessageId=0]
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  async getUnsummarizedMessages(conversationId, lastCondensedMessageId = 0, limit = 20) {
    const sql = `
      SELECT id, conversation_id, sender_type, content, token_count, created_at
      FROM messages
      WHERE conversation_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `;
    const [rows] = await baseRepository.query(sql, [
      conversationId,
      lastCondensedMessageId || 0,
      parseInt(limit, 10),
    ]);
    return rows;
  }
}

export const messageRepository = new MessageRepository();
export default messageRepository;
