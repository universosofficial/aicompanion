import summaryRepository from '../../repositories/summary.repository.js';
import messageRepository from '../../repositories/message.repository.js';
import openAiService from './openai.service.js';

/**
 * SummaryService
 * Manages rolling conversation summarization to preserve long-term context
 * within fixed token budgets.
 */
const activeSummaryConversations = new Set();

export class SummaryService {
  /**
   * Fetch current running summary for prompt injection.
   * @param {number|string} conversationId
   * @returns {Promise<string|null>}
   */
  async getSummaryForPrompt(conversationId) {
    try {
      const summaryRecord = await summaryRepository.findByConversationId(conversationId);
      return summaryRecord ? summaryRecord.summary_text : null;
    } catch (err) {
      console.warn('[SUMMARY SERVICE] Failed to fetch prompt summary:', err.message);
      return null;
    }
  }

  /**
   * Background task: Check if conversation messages past the last summary checkpoint
   * exceed the condensation threshold (default > 12 messages), and roll them into the summary.
   * @param {Object} params
   * @param {number|string} params.conversationId
   * @param {string} params.characterName
   * @param {number} [params.threshold=12]
   */
  async processRollingSummaryAsync({ conversationId, characterName, threshold = 12 }) {
    if (!conversationId || activeSummaryConversations.has(conversationId)) {
      return;
    }
    activeSummaryConversations.add(conversationId);

    try {
      const existingSummary = await summaryRepository.findByConversationId(conversationId);
      const lastCheckpointId = existingSummary ? existingSummary.last_condensed_message_id : 0;

      // Count messages newer than checkpoint
      const unsummarizedCount = await messageRepository.countUnsummarized(
        conversationId,
        lastCheckpointId
      );

      if (unsummarizedCount < threshold) {
        return;
      }

      console.log(
        `[SUMMARY WORKER] Conversation #${conversationId} reached ${unsummarizedCount} unsummarized turns. Rolling summary...`
      );

      // Fetch batch of older messages to condense (condense up to 15 at a time)
      const olderMessages = await messageRepository.getUnsummarizedMessages(
        conversationId,
        lastCheckpointId,
        15
      );

      if (olderMessages.length === 0) return;

      const previousSummaryText = existingSummary ? existingSummary.summary_text : '';
      const newSummaryText = await openAiService.condenseSummary({
        characterName,
        previousSummary: previousSummaryText,
        olderMessages,
      });

      const newCheckpointId = olderMessages[olderMessages.length - 1].id;

      await summaryRepository.upsert({
        conversationId,
        summaryText: newSummaryText,
        lastCondensedMessageId: newCheckpointId,
      });

      console.log(
        `[SUMMARY WORKER] Conversation #${conversationId} summary updated up to message #${newCheckpointId}.`
      );
    } catch (err) {
      console.error('[SUMMARY BACKGROUND TASK FAILED]', err.message);
    } finally {
      activeSummaryConversations.delete(conversationId);
    }
  }
}

export const summaryService = new SummaryService();
export default summaryService;
