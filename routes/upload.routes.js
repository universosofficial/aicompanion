import { Router } from 'express';
import multer from 'multer';
import authenticateToken from '../middleware/auth.middleware.js';
import cloudinaryService from '../services/cloudinary.service.js';
import characterRepository from '../repositories/character.repository.js';
import userMindRepository from '../repositories/user-mind.repository.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF) are allowed.'));
    }
  },
});

const router = Router();

/**
 * POST /api/upload/image
 * Generic image upload to Cloudinary (returns secure_url).
 * Requires authentication.
 */
router.post('/image', authenticateToken, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No image file was uploaded.' },
      });
    }

    const result = await cloudinaryService.uploadImageBuffer(req.file.buffer, {
      folder: 'ai_companion/avatars',
      mimetype: req.file.mimetype,
    });

    return res.status(200).json({
      success: true,
      data: {
        url: result.url,
        public_id: result.public_id,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/upload/mind-avatar
 * Upload avatar image specifically for user's dedicated 1:1 AI Mind.
 */
router.post('/mind-avatar', authenticateToken, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No image file was uploaded.' },
      });
    }

    const result = await cloudinaryService.uploadImageBuffer(req.file.buffer, {
      folder: 'ai_companion/minds',
      mimetype: req.file.mimetype,
    });

    // Update user's AI Mind in DB if mind exists
    const existingMind = await userMindRepository.findByUserId(req.user.id);
    if (existingMind) {
      await userMindRepository.upsert(req.user.id, {
        avatar_url: result.url,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        url: result.url,
        public_id: result.public_id,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/upload/character-avatar/:characterId
 * Upload avatar image for a private character persona.
 */
router.post('/character-avatar/:characterId', authenticateToken, upload.single('image'), async (req, res, next) => {
  try {
    const characterId = parseInt(req.params.characterId, 10);
    if (!characterId) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Valid character ID is required.' },
      });
    }

    const character = await characterRepository.findById(characterId, req.user.id);
    if (!character) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Character not found or unauthorized.' },
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No image file was uploaded.' },
      });
    }

    const result = await cloudinaryService.uploadImageBuffer(req.file.buffer, {
      folder: 'ai_companion/characters',
      mimetype: req.file.mimetype,
    });

    await characterRepository.update(characterId, req.user.id, {
      avatar_url: result.url,
    });

    return res.status(200).json({
      success: true,
      data: {
        url: result.url,
        public_id: result.public_id,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
