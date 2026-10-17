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
router.patch('/messages/:id', (req, res, next) => chatController.editMessage(req, res, next));
router.delete('/messages/:id', (req, res, next) => chatController.deleteMessage(req, res, next));
router.post('/voice-turn', upload.single('audio'), (req, res, next) => voiceController.voiceTurn(req, res, next));

// Fal.ai F5-TTS speak message endpoints
router.post('/messages/:messageId/speak', (req, res, next) => chatController.speakMessage(req, res, next));
router.get('/messages/:messageId/speak', (req, res, next) => chatController.speakMessage(req, res, next));
router.post('/:messageId/speak', (req, res, next) => chatController.speakMessage(req, res, next));
router.get('/:messageId/speak', (req, res, next) => chatController.speakMessage(req, res, next));

export default router;
