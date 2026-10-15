import pool from '../config/database.js';
import characterRepository from '../repositories/character.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import messageRepository from '../repositories/message.repository.js';
import pushService from '../services/notifications/push.service.js';
import { OpenAiService } from '../services/ai/openai.service.js';
import { buildProactiveInitiationPrompt } from '../services/ai/prompt.service.js';

const openaiService = new OpenAiService();

/**
 * Checks if a given time is within quiet hours (22:00 to 08:30).
 * @param {Date} date
 * @returns {boolean}
 */
export function isWithinQuietHours(date = new Date()) {
  const hours = date.getHours();
  const minutes = date.getMinutes();

  // 22:00 (10 PM) to midnight
  if (hours >= 22) return true;

  // Midnight to 08:30 AM
  if (hours < 8) return true;
  if (hours === 8 && minutes < 30) return true;

  return false;
}

/**
 * Executes a full proactive engagement scan cycle.
 * @param {Object} options
 * @param {boolean} [options.skipQuietHoursCheck=false]
 * @returns {Promise<Object>} Execution summary
 */
export async function runProactiveCheckinEvaluation({ skipQuietHoursCheck = false } = {}) {
  const now = new Date();
  console.log(`[PROACTIVE EVALUATION] Running evaluation cycle at ${now.toISOString()}...`);

  // 1. Guardrail: Quiet Hours Check
  if (!skipQuietHoursCheck && isWithinQuietHours(now)) {
    console.log(`[PROACTIVE EVALUATION] Current time (${now.toLocaleTimeString()}) is within quiet hours (22:00 - 08:30). Cycle skipped.`);
    return { skipped: true, reason: 'QUIET_HOURS' };
  }

  // 2. Discover candidates:
  // Mode A: Pending Unresolved Open Threads that have reached their trigger time
  const [pendingThreads] = await pool.query(`
    SELECT 
      t.id AS thread_id,
      t.user_id,
      t.character_id,
      t.topic_summary,
      t.trigger_after,
      ch.name AS character_name,
      ch.avatar_url,
      ch.allow_proactive_checkins
    FROM character_open_threads t
    JOIN characters ch ON t.character_id = ch.id
    WHERE t.is_resolved = FALSE 
      AND t.trigger_after <= NOW()
      AND (ch.allow_proactive_checkins = TRUE OR ch.allow_proactive_checkins IS NULL)
  `);

  // Mode B: Conversations with last activity between 18 and 72 hours ago
  const [inactiveConversations] = await pool.query(`
    SELECT 
      c.id AS conversation_id,
      c.user_id,
      c.character_id,
      ch.name AS character_name,
      ch.avatar_url,
      ch.allow_proactive_checkins,
      MAX(m.created_at) AS last_message_at
    FROM conversations c
    JOIN characters ch ON c.character_id = ch.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE (ch.allow_proactive_checkins = TRUE OR ch.allow_proactive_checkins IS NULL)
    GROUP BY c.id, c.user_id, c.character_id, ch.name, ch.avatar_url, ch.allow_proactive_checkins
    HAVING last_message_at BETWEEN DATE_SUB(NOW(), INTERVAL 72 HOUR) AND DATE_SUB(NOW(), INTERVAL 18 HOUR)
  `);

  console.log(`[PROACTIVE EVALUATION] Found ${pendingThreads.length} open thread(s) and ${inactiveConversations.length} inactive conversation(s).`);

  const processedPairs = new Set();
  const results = [];

  // Helper to process a single candidate user-character pair
  const evaluateCandidate = async (userId, characterId, openThread = null) => {
    const pairKey = `${userId}:${characterId}`;
    if (processedPairs.has(pairKey)) return null;
    processedPairs.add(pairKey);

    // Rate Limit Check: Max 1 proactive dispatch per user/character per 24 hours
    const [recentDispatches] = await pool.query(`
      SELECT id FROM proactive_dispatch_log
      WHERE user_id = ? AND character_id = ?
        AND dispatched_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      LIMIT 1
    `, [userId, characterId]);

    if (recentDispatches && recentDispatches.length > 0) {
      console.log(`[PROACTIVE EVALUATION] Skipping User ${userId} / Character ${characterId} (24h rate limit active).`);
      return { skipped: true, reason: 'RATE_LIMIT_24H', userId, characterId };
    }

    // Fetch character details
    const character = await characterRepository.findById(characterId);
    if (!character || character.allow_proactive_checkins === false) {
      return null;
    }

    // Fetch or create conversation
    let conversation = await conversationRepository.findByUserAndCharacter(userId, characterId);
    if (!conversation) {
      conversation = await conversationRepository.create({
        userId,
        characterId,
        title: `Chat with ${character.name}`,
      });
    }

    // Fetch recent 6 messages for context
    const recentMessages = await messageRepository.findRecentByConversationId(conversation.id, 6);
    const recentHistory = recentMessages.map((m) => ({
      role: m.sender_type === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    // Synthesize proactive text via persona prompt
    const prompt = buildProactiveInitiationPrompt(character, recentHistory, openThread);
    const aiResponse = await openaiService.generateChatCompletion({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Generate your natural check-in text now.' },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const proactiveText = aiResponse?.content?.trim();
    if (!proactiveText) {
      return null;
    }

    // Store message silently in the chat conversation
    const savedMessage = await messageRepository.create({
      conversationId: conversation.id,
      senderType: 'assistant',
      content: proactiveText,
      tokenCount: Math.ceil(proactiveText.length / 4),
    });

    // Dispatch Web Push notification
    const pushResult = await pushService.sendPushNotification(userId, {
      title: character.name,
      body: proactiveText,
      icon: character.avatar_url || 'https://api.dicebear.com/9.x/bottts/svg?seed=' + encodeURIComponent(character.name),
      dataUrl: `/chat/${character.id}`,
      characterId: character.id,
    });

    const reason = openThread ? 'open_thread_followup' : 'inactivity_checkin';

    // Record in dispatch log
    await pool.query(`
      INSERT INTO proactive_dispatch_log (user_id, character_id, message_id, dispatch_reason)
      VALUES (?, ?, ?, ?)
    `, [userId, characterId, savedMessage.id, reason]);

    // If an open thread was used, mark it resolved
    if (openThread && openThread.id) {
      await pool.query(`
        UPDATE character_open_threads 
        SET is_resolved = TRUE 
        WHERE id = ?
      `, [openThread.id]);
    }

    console.log(`[PROACTIVE EVALUATION] Dispatched check-in for User ${userId} from "${character.name}": "${proactiveText}" (Push: ${pushResult.sent} sent)`);

    return {
      success: true,
      userId,
      characterId,
      messageId: savedMessage.id,
      text: proactiveText,
      pushResult,
      reason,
    };
  };

  // Process open threads first (higher contextual priority)
  for (const thread of pendingThreads) {
    try {
      const res = await evaluateCandidate(thread.user_id, thread.character_id, thread);
      if (res) results.push(res);
    } catch (err) {
      console.error(`[PROACTIVE EVALUATION] Error processing thread ${thread.thread_id}:`, err.message);
    }
  }

  // Then process inactive conversations
  for (const conv of inactiveConversations) {
    try {
      const res = await evaluateCandidate(conv.user_id, conv.character_id, null);
      if (res) results.push(res);
    } catch (err) {
      console.error(`[PROACTIVE EVALUATION] Error processing conversation ${conv.conversation_id}:`, err.message);
    }
  }

  console.log(`[PROACTIVE EVALUATION] Evaluation cycle complete. Dispatched: ${results.filter((r) => r.success).length}`);
  return {
    success: true,
    dispatched: results.filter((r) => r.success).length,
    results,
  };
}

let checkinIntervalTimer = null;

/**
 * Initializes the recurring proactive check-in background worker.
 * Default schedule: Every 30 minutes.
 * @param {number} [intervalMs=1800000]
 */
export function startProactiveCheckinJob(intervalMs = 30 * 60 * 1000) {
  if (checkinIntervalTimer) {
    clearInterval(checkinIntervalTimer);
  }

  console.log(`[PROACTIVE JOB] Initializing proactive check-in job (every ${intervalMs / 60000} minutes)...`);

  // Run initial evaluation cycle after 30 seconds warmup
  setTimeout(() => {
    runProactiveCheckinEvaluation().catch((err) => {
      console.warn('[PROACTIVE JOB] Warmup cycle notice:', err.message);
    });
  }, 30000);

  // Set recurring interval
  checkinIntervalTimer = setInterval(() => {
    runProactiveCheckinEvaluation().catch((err) => {
      console.error('[PROACTIVE JOB] Scheduled cycle error:', err.message);
    });
  }, intervalMs);

  return checkinIntervalTimer;
}

/**
 * Stops the background worker.
 */
export function stopProactiveCheckinJob() {
  if (checkinIntervalTimer) {
    clearInterval(checkinIntervalTimer);
    checkinIntervalTimer = null;
    console.log('[PROACTIVE JOB] Proactive check-in job stopped.');
  }
}
