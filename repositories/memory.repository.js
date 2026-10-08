import baseRepository from './base.repository.js';
import { formatHumanRelativeDate, getHumanTimeAnchor } from '../services/ai/temporal.utils.js';

/**
 * MemoryRepository
 * Database access layer for companion long-term episodic and semantic memory,
 * with strict time/date conversation anchoring, chronological recall, and persona anchors.
 */
export class MemoryRepository {
  /**
   * Format memory row with human-friendly relative time and date formatting.
   * @param {Object} row
   * @returns {Object}
   */
  formatMemory(row) {
    if (!row) return null;
    const occurredAt = row.occurred_at || row.created_at;
    const convDate = row.conversation_date
      ? (row.conversation_date instanceof Date
          ? row.conversation_date.toISOString().split('T')[0]
          : String(row.conversation_date).split('T')[0])
      : (occurredAt ? new Date(occurredAt).toISOString().split('T')[0] : null);

    return {
      id: row.id,
      user_id: row.user_id,
      character_id: row.character_id,
      conversation_id: row.conversation_id || null,
      memory_type: row.memory_type || 'user_fact',
      category: row.category || 'fact',
      content: row.content,
      importance_score: Number(row.importance_score) || 3,
      occurred_at: occurredAt,
      conversation_date: convDate,
      temporal_anchor: row.temporal_anchor || getHumanTimeAnchor(occurredAt),
      relative_time: formatHumanRelativeDate(occurredAt),
      last_recalled_at: row.last_recalled_at,
      created_at: row.created_at,
    };
  }

  /**
   * Find top relevant memories for prompt injection.
   * Prioritizes character-specific and user-wide memories by importance score and recency.
   * Returns both persona anchors/shared events and time-anchored user facts/emotional states.
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} [params.characterId]
   * @param {number} [params.limit=10]
   * @returns {Promise<Array>}
   */
  async findRelevantMemories({ userId, characterId, limit = 10 }) {
    let sql;
    let params;

    if (characterId) {
      sql = `
        SELECT id, user_id, character_id, conversation_id, memory_type, category, content,
               importance_score, occurred_at, conversation_date, temporal_anchor, last_recalled_at, created_at
        FROM memories
        WHERE user_id = ? AND (character_id = ? OR character_id IS NULL)
        ORDER BY 
          CASE WHEN memory_type IN ('persona_anchor', 'shared_event') THEN 1 ELSE 2 END ASC,
          importance_score DESC, 
          occurred_at DESC
        LIMIT ?
      `;
      params = [userId, characterId, parseInt(limit, 10)];
    } else {
      sql = `
        SELECT id, user_id, character_id, conversation_id, memory_type, category, content,
               importance_score, occurred_at, conversation_date, temporal_anchor, last_recalled_at, created_at
        FROM memories
        WHERE user_id = ?
        ORDER BY 
          importance_score DESC, 
          occurred_at DESC
        LIMIT ?
      `;
      params = [userId, parseInt(limit, 10)];
    }

    const [rows] = await baseRepository.query(sql, params);
    return rows.map((r) => this.formatMemory(r));
  }

  /**
   * Fetch all memories for a user and companion (for memory inspector UI).
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} params.characterId
   * @returns {Promise<Array>}
   */
  async findAllByUserIdAndCharacter({ userId, characterId }) {
    const sql = `
      SELECT id, user_id, character_id, conversation_id, memory_type, category, content,
             importance_score, occurred_at, conversation_date, temporal_anchor, last_recalled_at, created_at
      FROM memories
      WHERE user_id = ? AND (character_id = ? OR character_id IS NULL)
      ORDER BY 
        CASE WHEN memory_type IN ('persona_anchor', 'shared_event') THEN 1 ELSE 2 END ASC,
        occurred_at DESC
    `;
    const [rows] = await baseRepository.query(sql, [userId, characterId]);
    return rows.map((r) => this.formatMemory(r));
  }

  /**
   * Insert a new extracted memory anchored to a conversation, date, and timestamp.
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string|null} [params.characterId=null]
   * @param {number|string|null} [params.conversationId=null]
   * @param {'persona_anchor'|'user_fact'|'shared_event'|'emotional_state'} [params.memoryType='user_fact']
   * @param {'preference'|'fact'|'relationship'|'goal'|'event'} [params.category='fact']
   * @param {string} params.content
   * @param {number} [params.importanceScore=3]
   * @param {Date|string|null} [params.occurredAt=null]
   * @param {string|null} [params.conversationDate=null]
   * @param {string|null} [params.temporalAnchor=null]
   * @returns {Promise<Object>} Created memory row
   */
  async create({
    userId,
    characterId = null,
    conversationId = null,
    memoryType = 'user_fact',
    category = 'fact',
    content,
    importanceScore = 3,
    occurredAt = null,
    conversationDate = null,
    temporalAnchor = null,
  }) {
    const validMemoryTypes = ['persona_anchor', 'user_fact', 'shared_event', 'emotional_state'];
    const resolvedType = validMemoryTypes.includes(memoryType) ? memoryType : 'user_fact';

    const validCategories = ['preference', 'fact', 'relationship', 'goal', 'event'];
    const resolvedCat = validCategories.includes(category) ? category : 'fact';

    const resolvedOccurredAt = occurredAt ? new Date(occurredAt) : new Date();
    const resolvedConvDate = conversationDate || resolvedOccurredAt.toISOString().split('T')[0];
    const resolvedAnchor = temporalAnchor || getHumanTimeAnchor(resolvedOccurredAt);

    const sql = `
      INSERT INTO memories (
        user_id, character_id, conversation_id, memory_type, category,
        content, importance_score, occurred_at, conversation_date, temporal_anchor
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await baseRepository.execute(sql, [
      userId,
      characterId,
      conversationId,
      resolvedType,
      resolvedCat,
      content.trim(),
      Math.min(5, Math.max(1, parseInt(importanceScore, 10) || 3)),
      resolvedOccurredAt,
      resolvedConvDate,
      resolvedAnchor,
    ]);

    return this.formatMemory({
      id: result.insertId,
      user_id: userId,
      character_id: characterId,
      conversation_id: conversationId,
      memory_type: resolvedType,
      category: resolvedCat,
      content: content.trim(),
      importance_score: importanceScore,
      occurred_at: resolvedOccurredAt.toISOString(),
      conversation_date: resolvedConvDate,
      temporal_anchor: resolvedAnchor,
      last_recalled_at: null,
      created_at: new Date().toISOString(),
    });
  }

  /**
   * Create a persona anchor memory (core historical anchor for the persona).
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} params.characterId
   * @param {string} params.content
   * @param {number} [params.importanceScore=5]
   * @returns {Promise<Object>}
   */
  async createPersonaAnchor({ userId, characterId, content, importanceScore = 5 }) {
    return await this.create({
      userId,
      characterId,
      memoryType: 'persona_anchor',
      category: 'relationship',
      content,
      importanceScore,
      temporalAnchor: 'core_anchor',
    });
  }

  /**
   * Delete a memory item with user ownership enforcement.
   * @param {number|string} id
   * @param {number|string} userId
   * @returns {Promise<boolean>}
   */
  async delete(id, userId) {
    const sql = `
      DELETE FROM memories
      WHERE id = ? AND user_id = ?
    `;
    const result = await baseRepository.execute(sql, [id, userId]);
    return result.affectedRows > 0;
  }

  /**
   * Touch last_recalled_at timestamp for recalled memories.
   * @param {Array<number|string>} memoryIds
   * @returns {Promise<void>}
   */
  async touchLastRecalled(memoryIds) {
    if (!Array.isArray(memoryIds) || memoryIds.length === 0) return;
    const placeholders = memoryIds.map(() => '?').join(', ');
    const sql = `
      UPDATE memories
      SET last_recalled_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
    `;
    await baseRepository.execute(sql, memoryIds);
  }
}

export const memoryRepository = new MemoryRepository();
export default memoryRepository;
