import { Router } from 'express';
import multer from 'multer';
import voiceController from '../controllers/voice.controller.js';
import authenticateToken from '../middleware/auth.middleware.js';

const router = Router();

// Configure Multer for in-memory audio buffers (.mp3, .wav, .m4a, .webm)
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max audio size
  },
  fileFilter: (req, file, cb) => {
    const isAudio =
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('video/') || // webm often labeled video/webm
      /\.(mp3|wav|m4a|webm|ogg|aac|flac)$/i.test(file.originalname);

    if (isAudio) {
      cb(null, true);
    } else {
      cb(new Error('Only valid audio formats (.mp3, .wav, .m4a, .webm) are supported.'));
    }
  },
});

/* ========================================================
   1. VOICE PRESETS & PREVIEWS
   ======================================================== */
router.get('/presets', (req, res, next) =>
  voiceController.getPresets(req, res, next)
);

/* ========================================================
   2. INSTANT VOICE CLONING (AUDIO SAMPLE UPLOAD)
   ======================================================== */
router.post('/clone', authenticateToken, audioUpload.single('sample'), (req, res, next) =>
  voiceController.cloneVoice(req, res, next)
);

/* ========================================================
   3. SPEECH-TO-TEXT (MICROPHONE TRANSCRIBE)
   ======================================================== */
router.post('/transcribe', authenticateToken, audioUpload.single('audio'), (req, res, next) =>
  voiceController.transcribeAudio(req, res, next)
);

/* ========================================================
   4. TEXT-TO-SPEECH SYNTHESIS
   ======================================================== */
router.post('/speak', (req, res, next) =>
  voiceController.speakText(req, res, next)
);

/* ========================================================
   5. END-TO-END VOICE CALL TURN
   ======================================================== */
router.post('/turn', authenticateToken, audioUpload.single('audio'), (req, res, next) =>
  voiceController.voiceTurn(req, res, next)
);

export default router;
