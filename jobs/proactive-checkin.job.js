import pool from '../config/database.js';
import characterRepository from '../repositories/character.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import messageRepository from '../repositories/message.repository.js';
import userRepository from '../repositories/user.repository.js';
import pushService from '../services/notifications/push.service.js';
import resendService from '../services/email/resend.service.js';
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

  // 1. Discover candidates:
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

  // Mode B: Conversations with last activity based on configurable intervals
  const [inactiveConversations] = await pool.query(`
    SELECT 
      c.id AS conversation_id,
      c.user_id,
      c.character_id,
      ch.name AS character_name,
      ch.avatar_url,
      ch.allow_proactive_checkins,
      ch.proactive_frequency,
      ch.proactive_preferred_time,
      ch.proactive_channels,
      MAX(m.created_at) AS last_message_at
    FROM conversations c
    JOIN characters ch ON c.character_id = ch.id
    JOIN messages m ON m.conversation_id = c.id
    WHERE (ch.allow_proactive_checkins = TRUE OR ch.allow_proactive_checkins IS NULL)
    GROUP BY c.id, c.user_id, c.character_id, ch.name, ch.avatar_url, ch.allow_proactive_checkins, ch.proactive_frequency, ch.proactive_preferred_time, ch.proactive_channels
    HAVING last_message_at <= DATE_SUB(NOW(), INTERVAL 2 HOUR)
  `);

  console.log(`[PROACTIVE EVALUATION] Found ${pendingThreads.length} open thread(s) and ${inactiveConversations.length} inactive conversation(s).`);

  const processedPairs = new Set();
  const results = [];

  // Helper to process a single candidate user-character pair
  const evaluateCandidate = async (userId, characterId, openThread = null) => {
    const pairKey = `${userId}:${characterId}`;
    if (processedPairs.has(pairKey)) return null;
    processedPairs.add(pairKey);

    // Fetch character details
    const character = await characterRepository.findById(characterId);
    if (!character || character.allow_proactive_checkins === false) {
      return null;
    }

    // 1. Resolve and parse flexible schedule settings
    let channels = { push: true, email: true };
    if (character.proactive_channels) {
      if (typeof character.proactive_channels === 'string') {
        try { channels = JSON.parse(character.proactive_channels); } catch {}
      } else if (typeof character.proactive_channels === 'object') {
        channels = character.proactive_channels;
      }
    }

    // 2. Resolve user timezone
    const userTz = channels.timezone || null;
    let userNow = now;
    if (userTz) {
      try {
        const tzStr = now.toLocaleString('en-US', { timeZone: userTz });
        userNow = new Date(tzStr);
      } catch {
        userNow = now;
      }
    }

    const userDayIdx = userNow.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const currentDayName = dayMap[userDayIdx];
    const userHour = userNow.getHours();
    const userMinute = userNow.getMinutes();

    // 3. Day-of-Week Flexibility Check
    const daysMode = channels.days_mode || 
      (character.proactive_frequency === 'weekdays' ? 'weekdays' : 
      (character.proactive_frequency === 'weekends' ? 'weekends' : 
      (character.proactive_frequency === 'custom_days' ? 'custom' : 'everyday')));

    if (daysMode === 'weekdays' && (userDayIdx === 0 || userDayIdx === 6)) {
      console.log(`[PROACTIVE EVALUATION] Skipping User ${userId} / Character ${characterId} (Scheduled for weekdays only, today is ${currentDayName}).`);
      return { skipped: true, reason: 'DAY_NOT_WEEKDAY', userId, characterId };
    }

    if (daysMode === 'weekends' && userDayIdx >= 1 && userDayIdx <= 5) {
      console.log(`[PROACTIVE EVALUATION] Skipping User ${userId} / Character ${characterId} (Scheduled for weekends only, today is ${currentDayName}).`);
      return { skipped: true, reason: 'DAY_NOT_WEEKEND', userId, characterId };
    }

    if (daysMode === 'custom' && Array.isArray(channels.custom_days) && channels.custom_days.length > 0) {
      const normalizedDays = channels.custom_days.map((d) => String(d).toLowerCase().slice(0, 3));
      if (!normalizedDays.includes(currentDayName)) {
        console.log(`[PROACTIVE EVALUATION] Skipping User ${userId} / Character ${characterId} (Configured for [${normalizedDays.join(', ')}], today is ${currentDayName}).`);
        return { skipped: true, reason: 'DAY_NOT_SCHEDULED', userId, characterId };
      }
    }

    // 4. Exact Particular Time vs. Time Window vs. Repetitive Interval Check
    const rawPrefTime = (character.proactive_preferred_time || channels.window || 'anytime').toLowerCase().trim();
    const exactTime = channels.exact_time || (/^\d{1,2}:\d{2}$/.test(rawPrefTime) ? rawPrefTime : null);
    const timingType = channels.timing_type || 
      (exactTime ? 'exact_time' : 
      (['morning', 'afternoon', 'evening', 'night'].includes(rawPrefTime) ? 'window' : 'interval'));

    if (timingType === 'exact_time' && exactTime) {
      const parts = exactTime.split(':').map((s) => parseInt(s, 10));
      const targetHour = parts[0];
      const targetMin = parts[1] || 0;
      const targetTotalMins = targetHour * 60 + targetMin;
      const userTotalMins = userHour * 60 + userMinute;
      const diffMins = userTotalMins - targetTotalMins;

      // Check within matching window (-10 to +45 minutes of scheduled time)
      if (diffMins < -10 || diffMins > 45) {
        return { skipped: true, reason: `OUTSIDE_EXACT_TIME_${exactTime}`, userId, characterId };
      }

      // Check if already dispatched in the last 18 hours (once per day)
      const [dispatchedToday] = await pool.query(`
        SELECT id FROM proactive_dispatch_log
        WHERE user_id = ? AND character_id = ?
          AND dispatched_at >= DATE_SUB(NOW(), INTERVAL 18 HOUR)
        LIMIT 1
      `, [userId, characterId]);

      if (dispatchedToday && dispatchedToday.length > 0) {
        console.log(`[PROACTIVE EVALUATION] Skipping User ${userId} / Character ${characterId} (Already dispatched daily message today).`);
        return { skipped: true, reason: 'ALREADY_DISPATCHED_TODAY', userId, characterId };
      }
    } else if (timingType === 'window') {
      if (rawPrefTime === 'morning' && (userHour < 8 || userHour >= 12)) {
        return { skipped: true, reason: 'OUTSIDE_PREFERRED_MORNING', userId, characterId };
      }
      if (rawPrefTime === 'afternoon' && (userHour < 12 || userHour >= 18)) {
        return { skipped: true, reason: 'OUTSIDE_PREFERRED_AFTERNOON', userId, characterId };
      }
      if (rawPrefTime === 'evening' && (userHour < 18 || userHour >= 22)) {
        return { skipped: true, reason: 'OUTSIDE_PREFERRED_EVENING', userId, characterId };
      }
      if (rawPrefTime === 'night' && (userHour < 21 && userHour >= 4)) {
        return { skipped: true, reason: 'OUTSIDE_PREFERRED_NIGHT', userId, characterId };
      }

      // Daily window cooldown (18 hours)
      const [recentWindowDispatches] = await pool.query(`
        SELECT id FROM proactive_dispatch_log
        WHERE user_id = ? AND character_id = ?
          AND dispatched_at >= DATE_SUB(NOW(), INTERVAL 18 HOUR)
        LIMIT 1
      `, [userId, characterId]);

      if (recentWindowDispatches && recentWindowDispatches.length > 0) {
        return { skipped: true, reason: 'ALREADY_DISPATCHED_IN_WINDOW', userId, characterId };
      }
    } else {
      // Repetition interval mode (e.g. 2h, 4h, 6h, 12h, 24h, 48h, weekly)
      const freqHoursMap = {
        '2h': 2,
        '4h': 4,
        '6h': 6,
        '12h': 12,
        '24h': 24,
        '48h': 48,
        'weekly': 168,
      };
      const intervalHours = freqHoursMap[character.proactive_frequency] || 24;

      // Check quiet hours in user's timezone for generic anytime intervals
      if (!skipQuietHoursCheck && isWithinQuietHours(userNow)) {
        return { skipped: true, reason: 'QUIET_HOURS', userId, characterId };
      }

      const [recentDispatches] = await pool.query(`
        SELECT id FROM proactive_dispatch_log
        WHERE user_id = ? AND character_id = ?
          AND dispatched_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
        LIMIT 1
      `, [userId, characterId, intervalHours]);

      if (recentDispatches && recentDispatches.length > 0) {
        console.log(`[PROACTIVE EVALUATION] Skipping User ${userId} / Character ${characterId} (${intervalHours}h rate limit active).`);
        return { skipped: true, reason: `RATE_LIMIT_${intervalHours}H`, userId, characterId };
      }
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

    // Dispatch Web Push notification only if channel enabled
    let pushResult = { sent: 0, skipped: true };
    if (channels.push !== false) {
      pushResult = await pushService.sendPushNotification(userId, {
        title: character.name,
        body: proactiveText,
        icon: character.avatar_url || 'https://api.dicebear.com/9.x/bottts/svg?seed=' + encodeURIComponent(character.name),
        dataUrl: `/chat/${character.id}`,
        characterId: character.id,
      });
    }

    // Dispatch Email Notification via Resend only if channel enabled
    if (channels.email !== false) {
      userRepository.findById(userId).then((user) => {
        if (user && user.email) {
          return resendService.sendNotificationEmail({
            to: user.email,
            title: `Message from ${character.name}`,
            message: proactiveText,
            companionName: character.name,
            companionAvatar: character.avatar_url || '',
            actionUrl: `${process.env.APP_URL || 'http://localhost:4200'}/chat/${character.id}`,
            actionText: `Reply to ${character.name}`,
          });
        }
      }).catch((emailErr) => {
        console.warn(`[PROACTIVE EVALUATION] Failed to dispatch Resend email to User ${userId}:`, emailErr.message);
      });
    }

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
export function startProactiveCheckinJob(intervalMs = 15 * 60 * 1000) {
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
