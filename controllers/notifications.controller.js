import env from '../config/env.js';
import pool from '../config/database.js';
import pushService from '../services/notifications/push.service.js';
import characterRepository from '../repositories/character.repository.js';
import { runProactiveCheckinEvaluation } from '../jobs/proactive-checkin.job.js';

export class NotificationsController {
  /**
   * Return public VAPID key for browser push registration.
   */
  async getVapidPublicKey(req, res, next) {
    try {
      res.json({
        success: true,
        data: {
          publicKey: env.VAPID_PUBLIC_KEY || '',
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Save browser push subscription for authenticated user.
   */
  async subscribe(req, res, next) {
    try {
      const userId = req.user.id;
      const subscription = req.body.subscription || req.body;
      const userAgent = req.body.userAgent || req.headers['user-agent'] || null;

      if (!subscription || !subscription.endpoint) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_SUBSCRIPTION', message: 'Endpoint is required.' },
        });
      }

      const result = await pushService.saveSubscription(userId, subscription, userAgent);

      res.status(201).json({
        success: true,
        message: 'Push subscription registered successfully.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Remove browser push subscription for authenticated user.
   */
  async unsubscribe(req, res, next) {
    try {
      const userId = req.user.id;
      const endpoint = req.body.endpoint;

      if (!endpoint) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Endpoint is required.' },
        });
      }

      await pushService.removeSubscription(userId, endpoint);

      res.json({
        success: true,
        message: 'Push subscription removed successfully.',
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Send a test push notification to user's registered devices.
   */
  async sendTestNotification(req, res, next) {
    try {
      const userId = req.user.id;
      const characterId = req.body.characterId || null;

      let charName = 'AI Companion';
      let avatarUrl = '/favicon.ico';

      if (characterId) {
        const char = await characterRepository.findById(characterId);
        if (char) {
          charName = char.name;
          avatarUrl = char.avatar_url || avatarUrl;
        }
      }

      const result = await pushService.sendPushNotification(userId, {
        title: charName,
        body: req.body.body || `Hey there! Just checking in to see how your day is going.`,
        icon: avatarUrl,
        dataUrl: characterId ? `/chat/${characterId}` : '/',
        characterId,
      });

      res.json({
        success: true,
        message: 'Test notification triggered.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Manually trigger proactive dispatch test or evaluation run.
   */
  async triggerProactiveEvaluation(req, res, next) {
    try {
      const { characterId, skipQuietHoursCheck = true } = req.body;
      const userId = req.user.id;

      if (characterId) {
        const result = await pushService.testProactiveDispatch(userId, characterId);
        return res.json({
          success: true,
          message: 'Targeted proactive check-in executed.',
          data: result,
        });
      }

      const runSummary = await runProactiveCheckinEvaluation({ skipQuietHoursCheck });
      res.json({
        success: true,
        message: 'Proactive evaluation cycle triggered.',
        data: runSummary,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Register a new open thread for future proactive check-in.
   */
  async createOpenThread(req, res, next) {
    try {
      const userId = req.user.id;
      const { characterId, topicSummary, triggerAfter } = req.body;

      if (!characterId || !topicSummary) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'characterId and topicSummary are required.' },
        });
      }

      // Default triggerAfter to 24 hours from now if omitted
      const triggerTime = triggerAfter ? new Date(triggerAfter) : new Date(Date.now() + 24 * 60 * 60 * 1000);

      const [result] = await pool.query(
        `INSERT INTO character_open_threads (user_id, character_id, topic_summary, trigger_after)
         VALUES (?, ?, ?, ?)`,
        [userId, characterId, topicSummary.trim(), triggerTime]
      );

      res.status(201).json({
        success: true,
        data: {
          id: result.insertId,
          userId,
          characterId,
          topicSummary: topicSummary.trim(),
          triggerAfter: triggerTime.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update character proactive check-ins toggle.
   */
  async updateCharacterProactiveSetting(req, res, next) {
    try {
      const userId = req.user.id;
      const characterId = req.params.characterId;
      const { allowProactive } = req.body;

      if (allowProactive === undefined) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'allowProactive boolean is required.' },
        });
      }

      const updated = await characterRepository.updateProactiveCheckins(
        characterId,
        userId,
        Boolean(allowProactive)
      );

      res.json({
        success: true,
        message: `Proactive check-ins ${allowProactive ? 'enabled' : 'disabled'} for character.`,
        data: updated,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const notificationsController = new NotificationsController();
export default notificationsController;
