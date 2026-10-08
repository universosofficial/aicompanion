import { Router } from 'express';
import characterController from '../controllers/character.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// All character endpoints require authentication
router.use(authenticateToken);

router.get('/', (req, res, next) => characterController.getCharacters(req, res, next));
router.get('/:id', (req, res, next) => characterController.getCharacterById(req, res, next));
router.post('/', (req, res, next) => characterController.createCharacter(req, res, next));
router.put('/:id', (req, res, next) => characterController.updateCharacter(req, res, next));
router.delete('/:id', (req, res, next) => characterController.deleteCharacter(req, res, next));

export default router;
