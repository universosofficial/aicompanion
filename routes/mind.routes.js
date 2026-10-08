import { Router } from 'express';
import multer from 'multer';
import mindsDiscoveryController from '../controllers/minds-discovery.controller.js';
import myMindController from '../controllers/my-mind.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';
import tokenService from '../services/token.service.js';

const router = Router();

// Configure Multer for in-memory file uploads (.pdf, .txt, .md)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const isAllowedExt = /\.(pdf|txt|md|markdown)$/i.test(file.originalname);
    if (isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported document format. Only .pdf, .txt, and .md files are allowed.'));
    }
  },
});

// Optional auth middleware for public exploration and consultation
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = tokenService.verifyAccessToken(token);
      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
      };
    } catch (_) {
      // Ignored for optional auth
    }
  }
  next();
}

/* ========================================================
   1. EXPLORATION & DISCOVERY (/api/minds/explore)
   ======================================================== */
router.get('/explore', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.exploreMinds(req, res, next)
);

router.get('/@:handle', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.getMindByHandle(req, res, next)
);

router.get('/:handle', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.getMindByHandle(req, res, next)
);

/* ========================================================
   2. CONSULTATION SESSIONS (ISOLATED & GROUNDED)
   ======================================================== */
router.post('/@:handle/consult', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.consultMind(req, res, next)
);

router.post('/:handle/consult', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.consultMind(req, res, next)
);

router.post('/:id/consult', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.consultMind(req, res, next)
);

// Backward-compatible alias
router.post('/@:handle/chat', optionalAuthenticate, (req, res, next) =>
  mindsDiscoveryController.consultMind(req, res, next)
);

export default router;
