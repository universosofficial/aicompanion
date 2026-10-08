import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';
import env from '../config/env.js';

class CloudinaryService {
  constructor() {
    this.configured = false;
    this.init();
  }

  init() {
    if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET,
        secure: true,
      });
      this.configured = true;
      console.log(`[CLOUDINARY] Configured for cloud: ${env.CLOUDINARY_CLOUD_NAME}`);
    } else if (env.CLOUDINARY_URL) {
      cloudinary.config({
        cloudinary_url: env.CLOUDINARY_URL,
        secure: true,
      });
      this.configured = true;
      console.log('[CLOUDINARY] Configured via CLOUDINARY_URL.');
    } else {
      this.configured = false;
      console.log('[CLOUDINARY] No credentials found in environment. Using smart local image data fallback.');
    }
  }

  isConfigured() {
    // Re-check in case .env was dynamically loaded
    if (!this.configured) {
      if (
        process.env.CLOUDINARY_URL ||
        (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
      ) {
        this.init();
      }
    }
    return this.configured;
  }

  /**
   * Upload an image buffer to Cloudinary with facial centering and optimization.
   * Falls back gracefully to base64 data URI if credentials are not yet configured.
   * @param {Buffer} buffer - Raw image file buffer
   * @param {Object} [options]
   * @param {string} [options.folder='ai_companion/avatars']
   * @param {string} [options.mimetype='image/jpeg']
   * @param {string} [options.publicId]
   * @returns {Promise<{ url: string, public_id?: string, provider: 'cloudinary' | 'fallback' }>}
   */
  async uploadImageBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Valid image buffer is required for upload.');
    }

    const folder = options.folder || 'ai_companion/avatars';
    const mimetype = options.mimetype || 'image/jpeg';

    if (this.isConfigured()) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: 'image',
            public_id: options.publicId,
            overwrite: true,
            transformation: [
              { width: 512, height: 512, crop: 'fill', gravity: 'face' },
              { quality: 'auto', fetch_format: 'auto' },
            ],
          },
          (error, result) => {
            if (error) {
              console.error('[CLOUDINARY UPLOAD ERROR]', error);
              return reject(error);
            }
            resolve({
              url: result.secure_url || result.url,
              public_id: result.public_id,
              format: result.format,
              bytes: result.bytes,
              provider: 'cloudinary',
            });
          }
        );

        Readable.from(buffer).pipe(stream);
      });
    }

    // Graceful fallback for local development without active Cloudinary keys
    const base64Data = buffer.toString('base64');
    const dataUri = `data:${mimetype};base64,${base64Data}`;

    return {
      url: dataUri,
      public_id: `local_fallback_${Date.now()}`,
      provider: 'fallback',
    };
  }

  /**
   * Upload an audio file buffer to Cloudinary (using resource_type: video for audio).
   * @param {Buffer} buffer - Raw audio file buffer (.mp3, .wav, .m4a)
   * @param {Object} [options]
   * @param {string} [options.folder='ai_companion/voice_samples']
   * @param {string} [options.mimetype='audio/mpeg']
   * @param {string} [options.publicId]
   * @returns {Promise<{ url: string, public_id?: string, duration?: number, provider: 'cloudinary' | 'fallback' }>}
   */
  async uploadAudioBuffer(buffer, options = {}) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Valid audio buffer is required for upload.');
    }

    const folder = options.folder || 'ai_companion/voice_samples';
    const mimetype = options.mimetype || 'audio/mpeg';

    if (this.isConfigured()) {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: 'auto', // Handles audio, video, raw safely without crashing on WebM/WAV/MP3
            public_id: options.publicId,
            overwrite: true,
          },
          (error, result) => {
            if (error) {
              console.error('[CLOUDINARY AUDIO UPLOAD ERROR]', error);
              return reject(error);
            }
            resolve({
              url: result.secure_url || result.url,
              public_id: result.public_id,
              format: result.format,
              duration: result.duration,
              bytes: result.bytes,
              provider: 'cloudinary',
            });
          }
        );

        Readable.from(buffer).pipe(stream);
      });
    }

    const base64Data = buffer.toString('base64');
    const dataUri = `data:${mimetype};base64,${base64Data}`;

    return {
      url: dataUri,
      public_id: `local_audio_${Date.now()}`,
      provider: 'fallback',
    };
  }
}

export const cloudinaryService = new CloudinaryService();
export default cloudinaryService;
