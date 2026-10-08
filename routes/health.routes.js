import { Router } from 'express';
import healthController from '../controllers/health.controller.js';

const router = Router();

// GET /api/health
router.get('/', (req, res, next) => healthController.getHealth(req, res, next));

export default router;
