import baseRepository from './base.repository.js';

/**
 * ConversationRepository
 * Database access layer for conversation sessions.
 */
export class ConversationRepository {
  /**
   * Create a new conversation session.
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} params.characterId
   * @param {string} [params.title='New Conversation']
   * @returns {Promise<Object>} Created conversation record
   */
  async create({ userId, characterId, title = 'New Conversation' }) {
    const sql = `
      INSERT INTO conversations (user_id, character_id, title)
      VALUES (?, ?, ?)
    `;
    const result = await baseRepository.execute(sql, [userId, characterId, title]);
    return await this.findById(result.insertId, userId);
  }

  /**
   * Find conversation between a specific user and character (most recent first).
   * @param {number|string} userId
   * @param {number|string} characterId
   * @returns {Promise<Object|null>}
   */
  async findByUserAndCharacter(userId, characterId) {
    const sql = `
      SELECT 
        id, user_id, character_id, title, is_pinned, 
        last_message_at, created_at, updated_at
      FROM conversations
      WHERE user_id = ? AND character_id = ?
      ORDER BY last_message_at DESC
      LIMIT 1
    `;
    return await baseRepository.queryOne(sql, [userId, characterId]);
  }

  /**
   * Find conversation by ID verifying user ownership.
   * @param {number|string} id
   * @param {number|string} userId
   * @returns {Promise<Object|null>}
   */
  async findById(id, userId) {
    const sql = `
      SELECT 
        id, user_id, character_id, title, is_pinned, 
        last_message_at, created_at, updated_at
      FROM conversations
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `;
    return await baseRepository.queryOne(sql, [id, userId]);
  }

  /**
   * Update the last message activity timestamp of a conversation.
   * @param {number|string} id
   * @returns {Promise<boolean>}
   */
  async updateLastMessageAt(id) {
    const sql = `
      UPDATE conversations
      SET last_message_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    const result = await baseRepository.execute(sql, [id]);
    return result.affectedRows > 0;
  }
}

export const conversationRepository = new ConversationRepository();
export default conversationRepository;
