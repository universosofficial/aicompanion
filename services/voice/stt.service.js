import OpenAI, { toFile } from 'openai';
import env from '../../config/env.js';

export class STTService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  /**
   * Transcribe user audio buffer into text using OpenAI Whisper API.
   * @param {Buffer} audioBuffer - Audio data buffer from mic recording (.webm, .wav, .mp3, .m4a)
   * @param {string} [filename='recording.webm']
   * @param {string} [mimeType='audio/webm']
   * @returns {Promise<{ transcript: string, duration?: number, language?: string }>}
   */
  async transcribeAudio(audioBuffer, filename = 'recording.webm', mimeType = 'audio/webm') {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new Error('Valid audio buffer is required for transcription.');
    }

    // Standardize file extension and sanitize MIME type for Whisper API compatibility
    const cleanMimeType = (mimeType || 'audio/wav').split(';')[0].trim().toLowerCase();
    let resolvedFilename = filename || 'recording.wav';

    if (cleanMimeType.includes('wav') || resolvedFilename.endsWith('.wav')) {
      resolvedFilename = 'recording.wav';
    } else if (cleanMimeType.includes('mp4') || cleanMimeType.includes('m4a') || resolvedFilename.endsWith('.m4a')) {
      resolvedFilename = 'recording.m4a';
    } else if (cleanMimeType.includes('mpeg') || cleanMimeType.includes('mp3') || resolvedFilename.endsWith('.mp3')) {
      resolvedFilename = 'recording.mp3';
    } else if (cleanMimeType.includes('ogg') || resolvedFilename.endsWith('.ogg')) {
      resolvedFilename = 'recording.ogg';
    } else if (cleanMimeType.includes('webm') || resolvedFilename.endsWith('.webm')) {
      resolvedFilename = 'recording.webm';
    } else {
      resolvedFilename = 'recording.wav';
    }

    const file = await toFile(audioBuffer, resolvedFilename, {
      type: cleanMimeType || 'audio/wav',
    });

    const response = await this.openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      temperature: 0.2,
    });

    return {
      transcript: (response.text || '').trim(),
      duration: response.duration || null,
      language: response.language || 'en',
    };
  }
}

export const sttService = new STTService();
export default sttService;
