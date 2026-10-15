import { Router } from 'express';
import sportsController from '../controllers/sports.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// All sports bankroll and intelligence routes require authentication
router.use(authenticateToken);

router.get('/bankroll', (req, res, next) => sportsController.getBankroll(req, res, next));
router.put('/bankroll', (req, res, next) => sportsController.updateBankroll(req, res, next));
router.post('/reset-tilt', (req, res, next) => sportsController.resetTilt(req, res, next));
router.post('/simulate-tilt', (req, res, next) => sportsController.simulateTilt(req, res, next));
router.get('/ledger', (req, res, next) => sportsController.getLedger(req, res, next));
router.get('/upcoming-matches', (req, res, next) => sportsController.getUpcomingMatches(req, res, next));
router.post('/preview-fixture', (req, res, next) => sportsController.previewFixture(req, res, next));

export default router;
