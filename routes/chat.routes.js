import { Router } from 'express';
import multer from 'multer';
import chatController from '../controllers/chat.controller.js';
import voiceController from '../controllers/voice.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// All chat endpoints require authentication
router.use(authenticateToken);

router.post('/conversations', (req, res, next) => chatController.startConversation(req, res, next));
router.get('/conversations/:id/messages', (req, res, next) => chatController.getMessages(req, res, next));
router.post('/message', (req, res, next) => chatController.sendMessage(req, res, next));
router.post('/stream', (req, res, next) => chatController.streamMessage(req, res, next));
router.post('/voice-turn', upload.single('audio'), (req, res, next) => voiceController.voiceTurn(req, res, next));

export default router;
