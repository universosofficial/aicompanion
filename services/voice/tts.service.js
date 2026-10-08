import OpenAI from 'openai';
import env from '../../config/env.js';

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
   * Generate raw MP3 speech audio buffer from text.
   * @param {Object} params
   * @param {string} params.text - Text to synthesize
   * @param {string} [params.voiceId='alloy'] - Preset voice id or external cloned id
   * @param {Object} [params.voiceSettings] - Optional speed, stability, etc.
   * @param {'preset'|'cloned'|'none'} [params.provider='preset']
   * @returns {Promise<Buffer>} MP3 audio buffer
   */
  async generateSpeechBuffer({ text, voiceId = 'alloy', voiceSettings = {}, provider = 'preset' }) {
    if (!text || !text.trim()) {
      throw new Error('Text is required for speech synthesis.');
    }

    const cleanText = text.trim();

    // 1. Check if ElevenLabs cloned voice synthesis is requested & configured
    if (provider === 'cloned' && env.ELEVENLABS_API_KEY && voiceId && !['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(voiceId)) {
      try {
        const elevenLabsBuffer = await this.synthesizeWithElevenLabs({
          text: cleanText,
          voiceId,
          voiceSettings,
        });
        if (elevenLabsBuffer) return elevenLabsBuffer;
      } catch (err) {
        console.warn('[TTS] ElevenLabs synthesis failed, falling back to OpenAI TTS:', err.message);
      }
    }

    // 2. Synthesize using OpenAI TTS API (tts-1) with accurately matched preset
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
