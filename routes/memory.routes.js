import { Router } from 'express';
import memoryController from '../controllers/memory.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// All memory endpoints require authentication
router.use(authenticateToken);

router.get('/:characterId', (req, res, next) => memoryController.getMemories(req, res, next));
router.post('/:characterId', (req, res, next) => memoryController.createMemory(req, res, next));
router.put('/:id', (req, res, next) => memoryController.updateMemory(req, res, next));
router.delete('/:id', (req, res, next) => memoryController.deleteMemory(req, res, next));

export default router;
