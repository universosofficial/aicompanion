import memoryRepository from '../../repositories/memory.repository.js';
import openAiService from './openai.service.js';
import { getCurrentTimeContext, getHumanTimeAnchor } from './temporal.utils.js';

/**
 * MemoryService
 * Handles long-term episodic/semantic memory retrieval, prompt formatting,
 * and asynchronous background memory extraction with strict time and date mapping.
 */
export class MemoryService {
  constructor() {
    this.activeExtractionUsers = new Set();
  }

  /**
   * Retrieve active memories to hydrate system prompt.
   * Touches last_recalled_at timestamp asynchronously.
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} [params.characterId]
   * @param {number} [params.limit=6]
   * @param {Date} [params.now=new Date()]
   * @returns {Promise<Array>}
   */
  async getMemoriesForPrompt({ userId, characterId, limit = 6, now = new Date() }) {
    try {
      const memories = await memoryRepository.findRelevantMemories({
        userId,
        characterId,
        limit,
      });

      if (memories.length > 0) {
        const memoryIds = memories.map((m) => m.id);
        // Touch recall timestamp asynchronously
        memoryRepository.touchLastRecalled(memoryIds).catch((err) => {
          console.warn('[MEMORY SERVICE] Failed to update recall timestamps:', err.message);
        });
      }

      return memories;
    } catch (err) {
      console.warn('[MEMORY SERVICE] Error fetching prompt memories:', err.message);
      return [];
    }
  }

  /**
   * Background task: Analyze recent chat turns, extract notable user memories,
   * and persist them mapped strictly to the conversation ID, calendar date, and exact timestamp.
   * Decoupled from user response pipeline with per-user concurrency locking.
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} [params.characterId]
   * @param {string} [params.characterName='Companion']
   * @param {Array} params.recentTurns
   * @param {number|string} [params.conversationId]
   * @param {Date|string} [params.conversationTimestamp=new Date()]
   */
  async extractAndSaveMemoriesAsync({
    userId,
    characterId = null,
    characterName = 'Companion',
    recentTurns = [],
    conversationId = null,
    conversationTimestamp = new Date(),
  }) {
    // Concurrency lock: prevent duplicate background extractions for the same user session
    const userLockKey = `${userId}_${characterId || 'global'}`;
    if (this.activeExtractionUsers.has(userLockKey)) {
      return;
    }

    try {
      // Memory extraction must strictly stem from actual user conversation
      const userTurns = (recentTurns || []).filter(
        (t) => (t.sender_type === 'user' || t.role === 'user') && t.content && t.content.trim().length > 0
      );
      if (userTurns.length === 0) return;

      const latestUserText = userTurns[userTurns.length - 1].content.trim().toLowerCase();
      // Skip trivial conversational fillers (under 12 chars without personal indicators)
      const isFiller =
        latestUserText.length < 12 &&
        !/\b(i|my|me|we|our|am|feel|want|plan|need|love|hate|wish|hope)\b/.test(latestUserText);
      if (isFiller) {
        return;
      }

      this.activeExtractionUsers.add(userLockKey);

      const convTime = conversationTimestamp instanceof Date ? conversationTimestamp : new Date(conversationTimestamp);
      const timeCtx = getCurrentTimeContext(convTime);

      const extractedItems = await openAiService.extractMemories({
        characterName,
        recentTurns,
        conversationTimestamp: convTime,
      });

      if (!extractedItems || extractedItems.length === 0) return;

      // Fetch existing memories to avoid redundant duplicates
      const existing = await memoryRepository.findAllByUserIdAndCharacter({
        userId,
        characterId,
      });
      const existingContents = new Set(existing.map((m) => m.content.toLowerCase().trim()));

      for (const item of extractedItems) {
        const normalized = item.content.toLowerCase().trim();
        if (!existingContents.has(normalized)) {
          const temporalAnchor = item.temporalAnchor || getHumanTimeAnchor(convTime);
          const savedMem = await memoryRepository.create({
            userId,
            characterId,
            conversationId,
            memoryType: item.memoryType || 'user_fact',
            category: item.category,
            content: item.content,
            importanceScore: item.importanceScore,
            occurredAt: convTime,
            conversationDate: timeCtx.calendarDate,
            temporalAnchor,
          });
          existingContents.add(normalized);
          console.log(
            `[TIME-MAPPED MEMORY] [${timeCtx.formattedDate} | Conv #${conversationId || 'N/A'}] [${(item.memoryType || 'USER_FACT').toUpperCase()} / ${(item.category || 'FACT').toUpperCase()}] "${item.content}" (score: ${item.importanceScore}, anchor: ${temporalAnchor})`
          );
        }
      }
    } catch (err) {
      console.error('[MEMORY EXTRACTION BACKGROUND TASK FAILED]', err.message);
    } finally {
      this.activeExtractionUsers.delete(userLockKey);
    }
  }

  /**
   * Retrieve all memories for character inspector drawer.
   */
  async getMemories(userId, characterId) {
    return await memoryRepository.findAllByUserIdAndCharacter({
      userId,
      characterId,
    });
  }

  /**
   * Delete a memory item.
   */
  async deleteMemory(id, userId) {
    return await memoryRepository.delete(id, userId);
  }
}

export const memoryService = new MemoryService();
export default memoryService;
