import webpush from 'web-push';
import env from '../../config/env.js';
import pool from '../../config/database.js';
import characterRepository from '../../repositories/character.repository.js';
import conversationRepository from '../../repositories/conversation.repository.js';
import messageRepository from '../../repositories/message.repository.js';
import { OpenAiService } from '../ai/openai.service.js';
import { buildProactiveInitiationPrompt } from '../ai/prompt.service.js';

// Configure VAPID details if keys are present
if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT || 'mailto:support@aicompanion.app',
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY
    );
    console.log('[PUSH SERVICE] VAPID details configured successfully.');
  } catch (err) {
    console.warn('[PUSH SERVICE] Failed to set VAPID details:', err.message);
  }
} else {
  console.warn('[PUSH SERVICE] VAPID keys not configured in environment.');
}

const openaiService = new OpenAiService();

export class PushNotificationService {
  /**
   * Save or upsert a browser push subscription.
   * @param {number|string} userId
   * @param {Object} subscriptionData - Web push Subscription object with endpoint and keys
   * @param {string} [userAgent]
   */
  async saveSubscription(userId, subscriptionData, userAgent = null) {
    if (!subscriptionData || !subscriptionData.endpoint) {
      const err = new Error('Invalid push subscription: missing endpoint.');
      err.statusCode = 400;
      throw err;
    }

    const endpoint = subscriptionData.endpoint;
    const p256dh = subscriptionData.keys?.p256dh || subscriptionData.p256dh || '';
    const auth = subscriptionData.keys?.auth || subscriptionData.auth || '';

    // Check if endpoint already exists for this user
    const [existing] = await pool.query(
      `SELECT id FROM user_push_subscriptions WHERE user_id = ? AND endpoint = ? LIMIT 1`,
      [userId, endpoint]
    );

    if (existing && existing.length > 0) {
      await pool.query(
        `UPDATE user_push_subscriptions 
         SET p256dh = ?, auth = ?, user_agent = ?, updated_at = NOW() 
         WHERE id = ?`,
        [p256dh, auth, userAgent, existing[0].id]
      );
      return { id: existing[0].id, updated: true };
    }

    const [result] = await pool.query(
      `INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, endpoint, p256dh, auth, userAgent]
    );

    return { id: result.insertId, created: true };
  }

  /**
   * Remove a push subscription.
   */
  async removeSubscription(userId, endpoint) {
    await pool.query(
      `DELETE FROM user_push_subscriptions WHERE user_id = ? AND endpoint = ?`,
      [userId, endpoint]
    );
    return { success: true };
  }

  /**
   * Retrieve all active push subscriptions for a user.
   */
  async getSubscriptions(userId) {
    const [rows] = await pool.query(
      `SELECT id, endpoint, p256dh, auth, user_agent, created_at 
       FROM user_push_subscriptions 
       WHERE user_id = ?`,
      [userId]
    );
    return rows;
  }

  /**
   * Dispatch Web Push notification to all active devices of a user.
   * Automatically prunes 410 Gone / 404 Not Found subscriptions.
   */
  async sendPushNotification(userId, { title, body, icon, dataUrl, characterId, badge, tag }) {
    const subscriptions = await this.getSubscriptions(userId);

    if (!subscriptions || subscriptions.length === 0) {
      console.log(`[PUSH SERVICE] User ${userId} has no registered push subscriptions.`);
      return { success: false, reason: 'NO_SUBSCRIPTIONS', sent: 0, pruned: 0 };
    }

    const payload = JSON.stringify({
      title: title || 'New companion check-in',
      body: body || '',
      icon: icon || '/favicon.ico',
      badge: badge || '/favicon.ico',
      data: {
        url: dataUrl || (characterId ? `/chat/${characterId}` : '/'),
        characterId: characterId || null,
        timestamp: Date.now(),
      },
      tag: tag || (characterId ? `proactive-${characterId}` : 'proactive-checkin'),
      renotify: true,
      vibrate: [200, 100, 200],
    });

    let sent = 0;
    let pruned = 0;
    let failed = 0;

    for (const sub of subscriptions) {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushConfig, payload);
        sent++;
      } catch (err) {
        // Prune expired or deactivated subscriptions (410 Gone or 404 Not Found)
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log(`[PUSH SERVICE] Pruning expired subscription ID ${sub.id} (HTTP ${err.statusCode})`);
          await pool.query(`DELETE FROM user_push_subscriptions WHERE id = ?`, [sub.id]);
          pruned++;
        } else {
          console.error(`[PUSH SERVICE] Failed to send push to subscription ${sub.id}:`, err.message);
          failed++;
        }
      }
    }

    return {
      success: sent > 0,
      sent,
      failed,
      pruned,
      total: subscriptions.length,
    };
  }

  /**
   * Direct manual test helper to verify proactive dispatch end-to-end.
   * Can be triggered via command line:
   * node -e "import('./services/notifications/push.service.js').then(m => m.testProactiveDispatch(1, 1))"
   */
  async testProactiveDispatch(userId, characterId) {
    console.log(`[TEST PROACTIVE] Initiating test proactive dispatch for User ${userId}, Character ${characterId}...`);

    // 1. Fetch character
    const character = await characterRepository.findById(characterId);
    if (!character) {
      throw new Error(`Character ${characterId} not found.`);
    }

    // 2. Fetch or create conversation
    let conversation = await conversationRepository.findByUserAndCharacter(userId, characterId);
    if (!conversation) {
      conversation = await conversationRepository.create({
        userId,
        characterId,
        title: `Chat with ${character.name}`,
      });
    }

    // 3. Check for any pending open threads
    const [threads] = await pool.query(
      `SELECT * FROM character_open_threads 
       WHERE user_id = ? AND character_id = ? AND is_resolved = FALSE 
       ORDER BY trigger_after ASC LIMIT 1`,
      [userId, characterId]
    );
    const openThread = threads && threads.length > 0 ? threads[0] : null;

    // 4. Fetch recent messages
    const recentMessages = await messageRepository.findRecentByConversationId(conversation.id, 6);
    const recentHistory = recentMessages.map((m) => ({
      role: m.sender_type === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    // 5. Generate message via Prompt
    const prompt = buildProactiveInitiationPrompt(character, recentHistory, openThread);
    const aiResponse = await openaiService.generateChatCompletion({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Text me a quick check-in right now.' },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const messageText = aiResponse?.content?.trim() || `Hey! Just thought of you—how is everything going today?`;

    // 6. Ingest into messages table
    const savedMessage = await messageRepository.create({
      conversationId: conversation.id,
      senderType: 'assistant',
      content: messageText,
      tokenCount: Math.ceil(messageText.length / 4),
    });

    console.log(`[TEST PROACTIVE] Message saved to conversation ${conversation.id}: "${messageText}"`);

    // 7. Dispatch Web Push notification
    const pushResult = await this.sendPushNotification(userId, {
      title: character.name,
      body: messageText,
      icon: character.avatar_url || 'https://api.dicebear.com/9.x/bottts/svg?seed=' + character.name,
      dataUrl: `/chat/${character.id}`,
      characterId: character.id,
    });

    console.log(`[TEST PROACTIVE] Push notification dispatch result:`, pushResult);

    // 8. Log to proactive_dispatch_log
    await pool.query(
      `INSERT INTO proactive_dispatch_log (user_id, character_id, message_id, dispatch_reason)
       VALUES (?, ?, ?, ?)`,
      [userId, characterId, savedMessage.id, openThread ? 'open_thread_followup' : 'test_manual_checkin']
    );

    if (openThread) {
      await pool.query(
        `UPDATE character_open_threads SET is_resolved = TRUE WHERE id = ?`,
        [openThread.id]
      );
    }

    console.log(`[TEST PROACTIVE] Complete! Proactive dispatch logged for Character ${character.name}.`);
    return {
      message: savedMessage,
      pushResult,
      openThread,
    };
  }
}

export const pushService = new PushNotificationService();
export default pushService;

// Also provide top-level test helper export for CLI convenience
export async function testProactiveDispatch(userId = 1, characterId = 1) {
  try {
    const res = await pushService.testProactiveDispatch(userId, characterId);
    console.log('[PROACTIVE TEST FINISHED SUCCESS]');
    return res;
  } catch (err) {
    console.error('[PROACTIVE TEST ERROR]', err);
    throw err;
  }
}
