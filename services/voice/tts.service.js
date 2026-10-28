import OpenAI from 'openai';
import env from '../../config/env.js';
import falVoiceService from './fal-voice.service.js';
import cloudinaryService from '../cloudinary.service.js';

/**
 * Curated preset voices with emotional relationship tags and descriptions.
 */
export const VOICE_PRESETS = [
  {
    id: 'onyx',
    name: 'Warm Paternal',
    gender: 'male',
    accent: 'American',
    recommendedFor: 'father',
    description: 'Deep, grounded, calming paternal presence with steady warmth.',
    provider: 'preset',
    previewText: 'Take a breath. No matter what comes up today, we will figure it out together.',
  },
  {
    id: 'nova',
    name: 'Gentle Maternal',
    gender: 'female',
    accent: 'American',
    recommendedFor: 'mother',
    description: 'Soft, empathetic, nurturing warmth with natural conversational cadence.',
    provider: 'preset',
    previewText: 'I am so glad you reached out. How are you really feeling right now?',
  },
  {
    id: 'echo',
    name: 'Direct Founder',
    gender: 'male',
    accent: 'American',
    recommendedFor: 'mentor',
    description: 'Decisive, clear, first-principles executive delivery with focused intensity.',
    provider: 'preset',
    previewText: 'Strip away the noise. What is the fundamental bottleneck you are facing?',
  },
  {
    id: 'alloy',
    name: 'Empathetic Friend',
    gender: 'neutral',
    accent: 'American',
    recommendedFor: 'friend',
    description: 'Approachable, warm, emotionally attuned peer with easy conversational rapport.',
    provider: 'preset',
    previewText: 'Hey! I was just thinking about you. Tell me what is on your mind today.',
  },
  {
    id: 'fable',
    name: 'Wise Mentor',
    gender: 'male',
    accent: 'British',
    recommendedFor: 'mentor',
    description: 'Thoughtful, articulate, nuanced cadence for philosophical reflection and counsel.',
    provider: 'preset',
    previewText: 'Often the most important questions are the ones we hesitate to ask ourselves.',
  },
  {
    id: 'shimmer',
    name: 'Reassuring Partner',
    gender: 'female',
    accent: 'American',
    recommendedFor: 'partner',
    description: 'Gentle, affectionate, clear presence that brings peace and reassurance.',
    provider: 'preset',
    previewText: 'You do not have to carry everything alone. I am right here with you.',
  },
];

export class TTSService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
  }

  /**
   * Return list of curated system preset voices
   */
  getPresets() {
    return VOICE_PRESETS;
  }

  /**
   * Resolve appropriate voice identifier.
   * If preset id matches known voice, returns it; otherwise defaults to alloy.
   */
  resolveVoiceId(voiceId) {
    if (!voiceId) return 'alloy';
    const clean = String(voiceId).toLowerCase().trim();
    const valid = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
    return valid.includes(clean) ? clean : 'alloy';
  }

  /**
   * Synthesize speech using fal.ai F5-TTS (or fallback) and return public audio URL.
   * @param {Object} params
   * @param {string} params.text
   * @param {string} [params.refAudioUrl]
   * @param {Object} [params.voiceSettings]
   * @returns {Promise<{ audioUrl: string, duration?: number }>}
   */
  async generateSpeechUrl({ text, voiceId = 'alloy', voiceSettings = {}, provider = 'preset', refAudioUrl = null, refText = '' }) {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      throw new Error('Text is required for speech synthesis.');
    }

    const isCloned = provider === 'cloned' && Boolean(refAudioUrl || voiceSettings?.voiceSampleUrl || voiceSettings?.sampleUrl);

    // 1. Cloned voice: fal.ai F5-TTS
    if (isCloned && falVoiceService.isConfigured()) {
      try {
        const refUrl = refAudioUrl || voiceSettings?.voiceSampleUrl || voiceSettings?.sampleUrl || null;
        const textRef = refText || voiceSettings?.ref_text || voiceSettings?.transcript || '';
        return await falVoiceService.generateSpeech({
          text: cleanText,
          refAudioUrl: refUrl,
          refText: textRef,
          modelType: 'F5-TTS',
          removeSilence: true,
        });
      } catch (err) {
        console.warn('[TTS] fal.ai F5-TTS generation error:', err.message);
      }
    }

    // 2. Preset voice: Fast OpenAI TTS API (tts-1, ~1 second response)
    const buffer = await this.generateSpeechBuffer({ text: cleanText, voiceId, voiceSettings, provider: 'preset', refAudioUrl, refText });
    
    // Store in Cloudinary for streaming URL if configured
    if (cloudinaryService && cloudinaryService.isConfigured()) {
      try {
        const cRes = await cloudinaryService.uploadAudioBuffer(buffer, {
          folder: 'ai_companion/voice_notes',
          mimetype: 'audio/mpeg',
          publicId: `vn_${Date.now()}`,
        });
        if (cRes?.url) {
          return {
            audioUrl: cRes.url,
            duration: Math.max(1, Math.round(cleanText.length / 15)),
            contentType: 'audio/mpeg',
          };
        }
      } catch (cErr) {
        console.warn('[TTS CLOUDINARY UPLOAD NOTICE]', cErr.message);
      }
    }

    return {
      audioUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`,
      duration: Math.max(1, Math.round(cleanText.length / 15)),
      contentType: 'audio/mpeg',
    };
  }

  /**
   * Generate raw speech audio buffer from text (powered by fast OpenAI TTS for presets, fal.ai for cloned).
   * @param {Object} params
   * @param {string} params.text - Text to synthesize
   * @param {string} [params.voiceId='alloy'] - Preset voice id or external cloned id
   * @param {Object} [params.voiceSettings] - Optional speed, stability, voiceSampleUrl, etc.
   * @param {'preset'|'cloned'|'none'} [params.provider='preset']
   * @param {string} [params.refAudioUrl]
   * @returns {Promise<Buffer>} Speech audio buffer
   */
  async generateSpeechBuffer({ text, voiceId = 'alloy', voiceSettings = {}, provider = 'preset', refAudioUrl = null, refText = '' }) {
    if (!text || !text.trim()) {
      throw new Error('Text is required for speech synthesis.');
    }

    const cleanText = text.trim();
    const isCloned = provider === 'cloned' && Boolean(refAudioUrl || voiceSettings?.voiceSampleUrl || voiceSettings?.sampleUrl);

    // 1. Cloned voice: fal.ai F5-TTS
    if (isCloned && falVoiceService.isConfigured()) {
      try {
        const refUrl = refAudioUrl || voiceSettings?.voiceSampleUrl || voiceSettings?.sampleUrl || null;
        const textRef = refText || voiceSettings?.ref_text || voiceSettings?.transcript || '';
        const falBuffer = await falVoiceService.generateSpeechBuffer({
          text: cleanText,
          refAudioUrl: refUrl,
          refText: textRef,
          modelType: 'F5-TTS',
          removeSilence: true,
        });
        if (falBuffer && falBuffer.length > 0) {
          return falBuffer;
        }
      } catch (falErr) {
        console.warn('[TTS] fal.ai F5-TTS buffer generation failed, falling back to OpenAI TTS:', falErr.message);
      }
    }

    // 2. Preset Voice Engine: Fast OpenAI TTS API (tts-1) (Takes ~1 second)
    const targetVoice = (voiceSettings && voiceSettings.mappedPreset) ? voiceSettings.mappedPreset : voiceId;
    const resolvedVoice = this.resolveVoiceId(targetVoice);
    const speed = Math.min(4.0, Math.max(0.25, parseFloat(voiceSettings?.speed) || 1.0));

    const response = await this.openai.audio.speech.create({
      model: 'tts-1',
      voice: resolvedVoice,
      input: cleanText,
      speed,
      response_format: 'mp3',
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Synthesize using ElevenLabs API (if ELEVENLABS_API_KEY is active).
   * @private
   */
  async synthesizeWithElevenLabs({ text, voiceId, voiceSettings }) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const stability = typeof voiceSettings?.stability === 'number' ? voiceSettings.stability : 0.75;
    const similarityBoost = typeof voiceSettings?.similarity_boost === 'number' ? voiceSettings.similarity_boost : 0.85;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`ElevenLabs API HTTP ${res.status}: ${errBody}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }
}

export const ttsService = new TTSService();
export default ttsService;
