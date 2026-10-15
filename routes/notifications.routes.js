import { Router } from 'express';
import notificationsController from '../controllers/notifications.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// Public: Fetch VAPID public key for browser service worker registration
router.get('/vapid-key', (req, res, next) => notificationsController.getVapidPublicKey(req, res, next));

// Authenticated routes
router.use(authenticateToken);

// Push subscription management
router.post('/subscribe', (req, res, next) => notificationsController.subscribe(req, res, next));
router.post('/unsubscribe', (req, res, next) => notificationsController.unsubscribe(req, res, next));

// Testing & manual triggers
router.post('/test', (req, res, next) => notificationsController.sendTestNotification(req, res, next));
router.post('/trigger-evaluation', (req, res, next) => notificationsController.triggerProactiveEvaluation(req, res, next));

// Contextual Open Threads
router.post('/threads', (req, res, next) => notificationsController.createOpenThread(req, res, next));

// Character proactive check-ins toggle
router.patch('/characters/:characterId/proactive-toggle', (req, res, next) => 
  notificationsController.updateCharacterProactiveSetting(req, res, next)
);

export default router;
