import { Router } from 'express';
import authController from '../controllers/auth.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// Public auth endpoints
router.post('/register', (req, res, next) => authController.register(req, res, next));
router.post('/login', (req, res, next) => authController.login(req, res, next));
router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));

// Protected profile endpoint
router.get('/me', authenticateToken, (req, res, next) => authController.getMe(req, res, next));

export default router;
