import * as fal from '@fal-ai/serverless-client';
import env from '../../config/env.js';
import cloudinaryService from '../cloudinary.service.js';
import sttService from './stt.service.js';

// Global default reference audio clip for F5-TTS when a character has no custom sample yet
const DEFAULT_FALLBACK_AUDIO_URL = 'https://github.com/SWivid/F5-TTS/raw/main/src/f5_tts/infer/examples/basic/basic_ref_en.wav';

// Configure fal credentials on module initialization
function configureFalClient() {
  const falKey = process.env.FAL_KEY || env.FAL_KEY;
  if (falKey) {
    fal.config({ credentials: falKey });
  }
}

configureFalClient();

/**
 * Sanitize AI chat response text into pristine conversational speech for TTS.
 * Removes markdown, code blocks, emojis, action tags, and ensures ending punctuation.
 */
export function sanitizeTextForTTS(text) {
  if (!text) return '';
  let cleaned = String(text);

  // 1. Remove code blocks and inline code
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // 2. Remove markdown links [text](url) -> text, and raw urls
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/\S+/gi, '');

  // 3. Remove stage directions / action asterisks e.g. *chuckles*, *sighs*
  cleaned = cleaned.replace(/\*[^*]+\*/g, '');
  cleaned = cleaned.replace(/\((?:chuckles|sighs|smiles|laughs|whispers|gasps|pauses|cries|nods)[^)]*\)/gi, '');

  // 4. Remove markdown headers, bold, italics, blockquotes, list markers
  cleaned = cleaned.replace(/^#+\s+/gm, '');
  cleaned = cleaned.replace(/^[*-]\s+/gm, '');
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');
  cleaned = cleaned.replace(/^>\s+/gm, '');

  // 5. Remove emojis and non-standard unicode symbols
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

  // 6. Clean excess whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // 7. Ensure clean ending punctuation for natural vocal decay
  if (cleaned && !/[.!?]$/.test(cleaned)) {
    cleaned += '.';
  }

  return cleaned;
}

/**
 * Split long AI replies into natural sentence chunks (~15-25 words / <=135 chars).
 * Non-autoregressive models like F5-TTS stay crisp and never stutter on sentence-sized chunks.
 */
export function splitIntoSentences(text, maxChunkLen = 135) {
  if (!text) return [];
  const rawSentences = text
    .split(/(?<=[.!?;\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSentences.length <= 1) {
    return [text];
  }

  const chunks = [];
  let current = '';

  for (const sentence of rawSentences) {
    if (!current) {
      current = sentence;
    } else if ((current + ' ' + sentence).length <= maxChunkLen) {
      current += ' ' + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Generate a standard 44-byte RIFF/WAVE header for concatenated raw PCM audio.
 */
function createStandardWavHeader(dataLength, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(dataLength + 36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // Linear PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/**
 * Concatenate multiple WAV audio buffers into a single continuous, seamless WAV.
 */
export function concatenateWavBuffers(buffers) {
  if (!buffers || buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];

  const pcmList = [];
  let totalPcmLength = 0;
  let sampleRate = 24000;
  let numChannels = 1;
  let bitsPerSample = 16;

  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    if (!buf || buf.length <= 44) continue;

    // Detect format from the first chunk
    if (i === 0 && buf.length >= 36) {
      try {
        numChannels = buf.readUInt16LE(22) || 1;
        sampleRate = buf.readUInt32LE(24) || 24000;
        bitsPerSample = buf.readUInt16LE(34) || 16;
      } catch (_) {}
    }

    // Locate the 'data' chunk
    const dataMarker = Buffer.from('data');
    const dataOffset = buf.indexOf(dataMarker);
    if (dataOffset !== -1 && dataOffset + 8 < buf.length) {
      const pcmData = buf.subarray(dataOffset + 8);
      pcmList.push(pcmData);
      totalPcmLength += pcmData.length;
    } else {
      // Fallback: standard 44-byte offset
      const pcmData = buf.subarray(44);
      pcmList.push(pcmData);
      totalPcmLength += pcmData.length;
    }
  }

  const header = createStandardWavHeader(totalPcmLength, sampleRate, numChannels, bitsPerSample);
  return Buffer.concat([header, ...pcmList]);
}

/**
 * FalVoiceService
 * Voice cloning & speech synthesis engine powered by fal.ai F5-TTS (fal-ai/f5-tts).
 */
export class FalVoiceService {
  constructor() {
    configureFalClient();
  }

  /**
   * Check whether a valid FAL_KEY is present in the environment.
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(process.env.FAL_KEY || env.FAL_KEY);
  }

  /**
   * Upload an audio sample to fal's cloud storage.
   * Accepts a Buffer, Blob, or existing public URL string.
   *
   * @param {Buffer|Blob|string} audioSample - Audio data buffer or existing URL
   * @param {string} [filename='sample.wav'] - Original audio filename
   * @param {string} [mimeType='audio/wav'] - MIME type
   * @returns {Promise<string>} Public URL of stored audio
   */
  async uploadAudioSample(audioSample, filename = 'sample.wav', mimeType = 'audio/wav') {
    if (!audioSample) {
      throw new Error('Audio sample is required for upload.');
    }

    // 1. If already a public web URL, return as-is
    if (typeof audioSample === 'string') {
      if (audioSample.startsWith('http://') || audioSample.startsWith('https://')) {
        return audioSample;
      }
      // If base64 data URI
      if (audioSample.startsWith('data:audio/')) {
        const base64Data = audioSample.split(',')[1];
        audioSample = Buffer.from(base64Data, 'base64');
      }
    }

    // 2. Refresh credentials
    configureFalClient();

    // 3. Upload to fal.ai cloud storage if key is configured
    if (this.isConfigured()) {
      try {
        let blob;
        if (typeof Blob !== 'undefined' && audioSample instanceof Blob) {
          blob = audioSample;
        } else if (Buffer.isBuffer(audioSample)) {
          blob = new Blob([audioSample], { type: mimeType });
        } else {
          blob = new Blob([Buffer.from(audioSample)], { type: mimeType });
        }

        const uploadedUrl = await fal.storage.upload(blob);
        if (uploadedUrl) {
          console.log(`[FAL STORAGE] Uploaded audio sample successfully: ${uploadedUrl}`);
          return uploadedUrl;
        }
      } catch (falErr) {
        console.warn('[FAL STORAGE ERROR] Fal storage upload failed, falling back:', falErr.message);
      }
    }

    // 4. Cloudinary cloud storage fallback if fal storage is not reachable
    if (Buffer.isBuffer(audioSample) && cloudinaryService.isConfigured()) {
      try {
        const result = await cloudinaryService.uploadAudioBuffer(audioSample, {
          folder: 'ai_companion/fal_voice_samples',
          mimetype: mimeType,
          publicId: `sample_${Date.now()}`,
        });
        if (result?.url) return result.url;
      } catch (cErr) {
        console.warn('[CLOUDINARY FALLBACK ERROR]', cErr.message);
      }
    }

    // 5. If buffer, return default reference URL as safe fallback
    return DEFAULT_FALLBACK_AUDIO_URL;
  }

  /**
   * Internal helper to synthesize a single sentence/chunk via fal-ai/f5-tts.
   * @private
   */
  async _generateSingleChunk({ text, refAudioUrl, refText, modelType, removeSilence }) {
    const inputPayload = {
      gen_text: text,
      ref_audio_url: refAudioUrl,
      model_type: modelType || 'F5-TTS',
      remove_silence: removeSilence !== false,
    };
    if (refText) {
      inputPayload.ref_text = refText;
    }

    const result = await fal.subscribe('fal-ai/f5-tts', {
      input: inputPayload,
      logs: false,
    });

    const rawAudio =
      result.data?.audio ||
      result.data?.audio_url ||
      result.audio ||
      result.audio_url;

    let audioUrl = null;
    if (typeof rawAudio === 'string') {
      audioUrl = rawAudio;
    } else if (rawAudio && typeof rawAudio === 'object' && rawAudio.url) {
      audioUrl = rawAudio.url;
    }

    if (!audioUrl) {
      throw new Error('F5-TTS chunk generation completed but no audio URL was returned by fal.ai.');
    }

    return {
      audioUrl,
      duration: rawAudio?.duration || result.data?.audio?.duration || null,
      contentType: rawAudio?.content_type || 'audio/wav',
    };
  }

  /**
   * Synthesize speech using fal.ai F5-TTS (fal-ai/f5-tts).
   * Automatically sanitizes text and breaks multi-sentence paragraphs into
   * natural sentence chunks for pristine fluency without stuttering or looping.
   *
   * @param {Object} params
   * @param {string} params.text - The text to speak (gen_text)
   * @param {string} [params.refAudioUrl] - Public URL to reference character voice
   * @param {Buffer|Blob} [params.refAudioBuffer] - Raw reference audio buffer to upload
   * @param {string} [params.modelType='F5-TTS'] - Model type (F5-TTS or E2-TTS)
   * @param {boolean} [params.removeSilence=true] - Remove silence from output
   * @returns {Promise<{ audioUrl: string, duration?: number, contentType?: string, raw?: any }>}
   */
  async generateSpeech({
    text,
    refAudioUrl = null,
    refAudioBuffer = null,
    refText = '',
    modelType = 'F5-TTS',
    removeSilence = true,
  }) {
    if (!text || !text.trim()) {
      throw new Error('Text is required for speech synthesis.');
    }

    // 1. Sanitize AI text for natural conversational speech
    const cleanText = sanitizeTextForTTS(text);
    if (!cleanText) {
      throw new Error('Text contains no speakable speech content.');
    }

    // 2. Resolve reference audio URL
    let resolvedRefUrl = refAudioUrl;
    if (!resolvedRefUrl && refAudioBuffer) {
      resolvedRefUrl = await this.uploadAudioSample(refAudioBuffer);
    }
    if (!resolvedRefUrl || !resolvedRefUrl.startsWith('http')) {
      resolvedRefUrl = DEFAULT_FALLBACK_AUDIO_URL;
    }

    // 3. Ensure fal credentials are up to date
    configureFalClient();

    if (!this.isConfigured()) {
      throw new Error(
        'FAL_KEY environment variable is not configured. Please set FAL_KEY in your .env file or environment.'
      );
    }

    // 4. Resolve reference transcript (ref_text)
    let resolvedRefText = (refText || '').trim();
    if (!resolvedRefText && resolvedRefUrl && !resolvedRefUrl.includes('basic_ref_en.wav')) {
      try {
        const audioFetch = await fetch(resolvedRefUrl);
        if (audioFetch.ok) {
          const audioBuffer = Buffer.from(await audioFetch.arrayBuffer());
          const transcription = await sttService.transcribeAudio(audioBuffer, 'reference.wav', 'audio/wav');
          if (transcription?.transcript) {
            resolvedRefText = transcription.transcript.trim();
            console.log(`[FAL F5-TTS] Auto-transcribed reference speech for cloning: "${resolvedRefText}"`);
          }
        }
      } catch (sttErr) {
        console.warn('[FAL F5-TTS] Auto-transcription note:', sttErr.message);
      }
    }

    // 5. If text contains multiple sentences and is longer than 135 chars, chunk and stitch
    const chunks = splitIntoSentences(cleanText, 135);

    if (chunks.length > 1) {
      console.log(`[FAL F5-TTS] Multi-sentence synthesis (${chunks.length} chunks) for seamless sentence flow`);
      const buffer = await this.generateSpeechBuffer({
        text: cleanText,
        refAudioUrl: resolvedRefUrl,
        refText: resolvedRefText,
        modelType,
        removeSilence,
      });

      const uploadedUrl = await this.uploadAudioSample(buffer, `stitched_${Date.now()}.wav`, 'audio/wav');
      const estimatedDuration = Math.max(1, Math.round(cleanText.length / 14));
      return {
        audioUrl: uploadedUrl,
        duration: estimatedDuration,
        contentType: 'audio/wav',
      };
    }

    // Single chunk generation
    console.log(`[FAL F5-TTS] Subscribing to fal-ai/f5-tts for text: "${cleanText.slice(0, 50)}..."`);
    const singleResult = await this._generateSingleChunk({
      text: cleanText,
      refAudioUrl: resolvedRefUrl,
      refText: resolvedRefText,
      modelType,
      removeSilence,
    });

    console.log(`[FAL F5-TTS SUCCESS] Audio generated successfully: ${singleResult.audioUrl}`);
    return singleResult;
  }

  /**
   * Synthesize speech and return a raw Buffer (for binary stream responses or saving to disk).
   * Automatically handles multi-sentence responses by synthesizing chunks in parallel and stitching.
   *
   * @param {Object} params
   * @returns {Promise<Buffer>}
   */
  async generateSpeechBuffer(params) {
    const { text, refAudioUrl, refText, modelType = 'F5-TTS', removeSilence = true } = params;
    const cleanText = sanitizeTextForTTS(text || '');
    if (!cleanText) {
      throw new Error('Text is required for speech synthesis.');
    }

    let resolvedRefUrl = refAudioUrl;
    if (!resolvedRefUrl || !resolvedRefUrl.startsWith('http')) {
      resolvedRefUrl = DEFAULT_FALLBACK_AUDIO_URL;
    }

    let resolvedRefText = (refText || '').trim();
    if (!resolvedRefText && resolvedRefUrl && !resolvedRefUrl.includes('basic_ref_en.wav')) {
      try {
        const audioFetch = await fetch(resolvedRefUrl);
        if (audioFetch.ok) {
          const audioBuffer = Buffer.from(await audioFetch.arrayBuffer());
          const transcription = await sttService.transcribeAudio(audioBuffer, 'reference.wav', 'audio/wav');
          if (transcription?.transcript) {
            resolvedRefText = transcription.transcript.trim();
          }
        }
      } catch (_) {}
    }

    const chunks = splitIntoSentences(cleanText, 135);

    if (chunks.length <= 1) {
      const single = await this._generateSingleChunk({
        text: cleanText,
        refAudioUrl: resolvedRefUrl,
        refText: resolvedRefText,
        modelType,
        removeSilence,
      });
      const response = await fetch(single.audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio from fal storage URL: HTTP ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    // Parallel chunk synthesis
    console.log(`[FAL F5-TTS BUFFER] Generating ${chunks.length} sentence chunks in parallel...`);
    const chunkResults = await Promise.all(
      chunks.map((chunk) =>
        this._generateSingleChunk({
          text: chunk,
          refAudioUrl: resolvedRefUrl,
          refText: resolvedRefText,
          modelType,
          removeSilence,
        })
      )
    );

    const chunkBuffers = await Promise.all(
      chunkResults.map(async (r) => {
        const res = await fetch(r.audioUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} downloading chunk audio`);
        return Buffer.from(await res.arrayBuffer());
      })
    );

    const combinedBuffer = concatenateWavBuffers(chunkBuffers);
    console.log(`[FAL F5-TTS BUFFER SUCCESS] Stitched ${chunkBuffers.length} sentence chunks into ${combinedBuffer.length} bytes`);
    return combinedBuffer;
  }
}

export const falVoiceService = new FalVoiceService();
export default falVoiceService;
