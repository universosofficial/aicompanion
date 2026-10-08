import { Router } from 'express';
import multer from 'multer';
import authenticateToken from '../middleware/auth.middleware.js';
import myMindController from '../controllers/my-mind.controller.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max
});

const router = Router();

// All routes require authentication
router.use(authenticateToken);

router.get('/', (req, res, next) => myMindController.getMyMind(req, res, next));
router.put('/', (req, res, next) => myMindController.updateMyMind(req, res, next));
router.post('/sources/url', (req, res, next) => myMindController.ingestUrl(req, res, next));
router.post('/sources/file', upload.single('file'), (req, res, next) => myMindController.ingestDocument(req, res, next));
router.post('/sources/text', (req, res, next) => myMindController.ingestText(req, res, next));
router.delete('/sources/:id', (req, res, next) => myMindController.deleteSource(req, res, next));

export default router;
