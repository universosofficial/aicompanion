import { Router } from 'express';
import authController from '../controllers/auth.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// Public auth endpoints
router.post('/register', (req, res, next) => authController.register(req, res, next));
router.post('/verify-email', (req, res, next) => authController.verifyEmail(req, res, next));
router.post('/resend-verification', (req, res, next) => authController.resendVerification(req, res, next));

router.post('/login', (req, res, next) => authController.login(req, res, next));
router.post('/verify-login-code', (req, res, next) => authController.verifyLoginCode(req, res, next));
router.post('/resend-login-code', (req, res, next) => authController.resendLoginCode(req, res, next));

router.post('/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/reset-password', (req, res, next) => authController.resetPassword(req, res, next));

router.post('/refresh', (req, res, next) => authController.refresh(req, res, next));
router.post('/logout', (req, res, next) => authController.logout(req, res, next));

// Protected profile endpoints
router.get('/me', authenticateToken, (req, res, next) => authController.getMe(req, res, next));
router.put('/profile', authenticateToken, (req, res, next) => authController.updateProfile(req, res, next));
router.post('/change-password', authenticateToken, (req, res, next) => authController.changePassword(req, res, next));

export default router;
