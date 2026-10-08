import baseRepository from './base.repository.js';

/**
 * SummaryRepository
 * Database access layer for rolling condensed conversation summaries.
 */
export class SummaryRepository {
  /**
   * Find running summary by conversation ID.
   * @param {number|string} conversationId
   * @returns {Promise<Object|null>}
   */
  async findByConversationId(conversationId) {
    const sql = `
      SELECT id, conversation_id, summary_text, last_condensed_message_id, updated_at
      FROM summaries
      WHERE conversation_id = ?
      LIMIT 1
    `;
    return await baseRepository.queryOne(sql, [conversationId]);
  }

  /**
   * Insert or update running summary for a conversation.
   * @param {Object} params
   * @param {number|string} params.conversationId
   * @param {string} params.summaryText
   * @param {number|string} params.lastCondensedMessageId
   * @returns {Promise<Object>}
   */
  async upsert({ conversationId, summaryText, lastCondensedMessageId }) {
    const sql = `
      INSERT INTO summaries (conversation_id, summary_text, last_condensed_message_id)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        summary_text = VALUES(summary_text),
        last_condensed_message_id = VALUES(last_condensed_message_id),
        updated_at = CURRENT_TIMESTAMP
    `;

    await baseRepository.execute(sql, [
      conversationId,
      summaryText.trim(),
      lastCondensedMessageId,
    ]);

    return await this.findByConversationId(conversationId);
  }
}

export const summaryRepository = new SummaryRepository();
export default summaryRepository;
