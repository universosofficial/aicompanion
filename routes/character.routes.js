import { Router } from 'express';
import multer from 'multer';
import characterController from '../controllers/character.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// All character endpoints require authentication
router.use(authenticateToken);

router.get('/', (req, res, next) => characterController.getCharacters(req, res, next));
router.post('/generate-magic', (req, res, next) => characterController.generateMagicPersona(req, res, next));
router.post('/preview-vibe', (req, res, next) => characterController.previewPersonaVibe(req, res, next));
router.get('/:id', (req, res, next) => characterController.getCharacterById(req, res, next));
router.post('/', (req, res, next) => characterController.createCharacter(req, res, next));
router.put('/:id', (req, res, next) => characterController.updateCharacter(req, res, next));
router.delete('/:id', (req, res, next) => characterController.deleteCharacter(req, res, next));

// Fal.ai Voice Sample Endpoints
router.post('/:id/voice-sample', audioUpload.single('sample'), (req, res, next) =>
  characterController.uploadVoiceSample(req, res, next)
);
router.get('/:id/voice-sample', (req, res, next) =>
  characterController.getVoiceSample(req, res, next)
);

export default router;
