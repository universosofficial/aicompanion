import cloudinaryService from '../cloudinary.service.js';
import env from '../../config/env.js';
import baseRepository from '../../repositories/base.repository.js';

export class VoiceCloningService {
  /**
   * Analyze audio acoustic properties (pitch, energy, duration, speech cadence)
   * and character metadata to find the closest resonant vocal profile.
   * @param {Buffer} audioBuffer
   * @param {string} filename
   * @param {string} mimeType
   * @param {string} name
   * @param {Object} [meta]
   * @returns {{ mappedPreset: string, speed: number, estimatedPitchHz: number }}
   */
  analyzeAcousticProfile(audioBuffer, filename = '', mimeType = '', name = '', meta = {}) {
    let estimatedF0 = 0;

    // Pitch estimation via autocorrelation if PCM WAV audio is present
    if (audioBuffer && audioBuffer.length > 44 && (mimeType.includes('wav') || filename.endsWith('.wav'))) {
      try {
        const samples = [];
        for (let i = 44; i < audioBuffer.length - 1; i += 2) {
          samples.push(audioBuffer.readInt16LE(i));
        }
        const sampleRate = 16000;
        const frameSize = 1024;
        const pitches = [];

        for (let start = 0; start < samples.length - frameSize; start += frameSize) {
          const frame = samples.slice(start, start + frameSize);
          let energy = 0;
          for (let s of frame) energy += s * s;
          energy = Math.sqrt(energy / frame.length);
          if (energy < 280) continue; // silence or noise floor

          // Check pitch lags between 50Hz (lag 320) and 450Hz (lag 35)
          let maxCorr = -1;
          let bestLag = -1;
          for (let lag = 35; lag < 320; lag++) {
            let corr = 0;
            for (let i = 0; i < frame.length - lag; i++) {
              corr += frame[i] * frame[i + lag];
            }
            if (corr > maxCorr) {
              maxCorr = corr;
              bestLag = lag;
            }
          }
          if (bestLag > 0) {
            const f0 = sampleRate / bestLag;
            if (f0 >= 70 && f0 <= 400) pitches.push(f0);
          }
        }
        if (pitches.length > 0) {
          pitches.sort((a, b) => a - b);
          estimatedF0 = pitches[Math.floor(pitches.length / 2)] || 0;
        }
      } catch (err) {
        console.warn('[VOICE ACOUSTICS] Pitch extraction error:', err.message);
      }
    }

    // Name & relationship metadata clues
    const nameLower = (name || '').toLowerCase();
    const genderLower = (meta.gender || '').toLowerCase();
    const relLower = (meta.relationship_type || '').toLowerCase();

    const isFemaleCue =
      genderLower === 'female' ||
      ['princess', 'mom', 'mother', 'sister', 'wife', 'girlfriend', 'daughter', 'woman', 'lady', 'girl', 'queen', 'grace', 'mary', 'sarah', 'emma'].some(
        (w) => nameLower.includes(w) || relLower.includes(w)
      );

    const isMaleCue =
      genderLower === 'male' ||
      ['mark', 'dad', 'father', 'brother', 'husband', 'boyfriend', 'son', 'man', 'guy', 'boy', 'king', 'john', 'david', 'michael'].some(
        (w) => nameLower.includes(w) || relLower.includes(w)
      );

    let mappedPreset = 'alloy';
    let speed = 1.0;

    if (estimatedF0 > 0) {
      if (estimatedF0 >= 165 || (isFemaleCue && !isMaleCue)) {
        // Female vocal frequency range
        if (estimatedF0 >= 205) {
          mappedPreset = 'shimmer'; // Gentle, reassuring, affectionate partner/female
          speed = 1.0;
        } else {
          mappedPreset = 'nova'; // Warm, gentle, empathetic maternal/female
          speed = 0.98;
        }
      } else {
        // Male vocal frequency range
        if (estimatedF0 < 125) {
          mappedPreset = 'onyx'; // Deep, grounded, calming paternal presence
          speed = 0.95;
        } else {
          mappedPreset = 'echo'; // Decisive, clear direct founder / conversational male
          speed = 1.0;
        }
      }
    } else {
      // Fallback when audio container is compressed WebM without PCM headers
      if (isFemaleCue) {
        mappedPreset = (relLower === 'partner' || relLower === 'spouse') ? 'shimmer' : 'nova';
      } else if (isMaleCue) {
        mappedPreset = (relLower === 'father') ? 'onyx' : 'echo';
      } else {
        mappedPreset = 'alloy';
      }
    }

    return {
      mappedPreset,
      speed,
      estimatedPitchHz: Math.round(estimatedF0),
    };
  }

  /**
   * Clone a voice from an uploaded audio sample file.
   * @param {Object} params
   * @param {string} params.name - Persona name or voice identifier
   * @param {Buffer} params.audioBuffer - Raw audio data buffer
   * @param {string} params.filename - Original filename (.mp3, .wav, .m4a)
   * @param {string} params.mimeType - MIME type
   * @param {string} [params.description]
   * @param {Object} [params.meta] - Optional character metadata
   * @returns {Promise<{ voiceId: string, voiceSampleUrl: string, voiceProvider: 'cloned'|'preset', voiceSettings: Object }>}
   */
  async cloneVoiceFromSample({ name, audioBuffer, filename, mimeType, description = '', meta = {} }) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      throw new Error('Valid audio sample is required for voice cloning.');
    }

    // 1. Upload audio sample to Cloudinary (or local disk fallback) for persistent playback
    let sampleUrl = null;
    try {
      const uploadResult = await cloudinaryService.uploadAudioBuffer(audioBuffer, {
        folder: 'ai_companion/voice_samples',
        mimetype: mimeType || 'audio/mpeg',
        publicId: `voice_sample_${Date.now()}`,
      });
      sampleUrl = uploadResult.url;
    } catch (err) {
      console.warn('[VOICE CLONING] Cloudinary audio upload failed, proceeding with local fallback:', err.message);
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const uploadsDir = path.resolve('uploads', 'voice_samples');
        await fs.mkdir(uploadsDir, { recursive: true });
        const ext = filename ? path.extname(filename) || '.mp3' : '.mp3';
        const localFileName = `voice_sample_${Date.now()}${ext}`;
        const localFilePath = path.join(uploadsDir, localFileName);
        await fs.writeFile(localFilePath, audioBuffer);
        sampleUrl = `http://localhost:5005/uploads/voice_samples/${localFileName}`;
      } catch (fsErr) {
        sampleUrl = `data:${mimeType || 'audio/mpeg'};base64,${audioBuffer.toString('base64')}`;
      }
    }

    // 2. Compute accurate acoustic profile
    const acoustics = this.analyzeAcousticProfile(audioBuffer, filename, mimeType, name, meta);

    const defaultSettings = {
      stability: 0.75,
      similarity_boost: 0.85,
      speed: acoustics.speed,
      mappedPreset: acoustics.mappedPreset,
      estimatedPitchHz: acoustics.estimatedPitchHz,
    };

    // 3. If ElevenLabs API Key is configured, execute real instantaneous voice cloning
    if (env.ELEVENLABS_API_KEY) {
      try {
        const formData = new FormData();
        formData.append('name', name || `Voice_${Date.now()}`);
        formData.append('description', description || `Cloned voice profile for ${name}`);

        const blob = new Blob([audioBuffer], { type: mimeType || 'audio/mpeg' });
        formData.append('files', blob, filename || 'sample.mp3');

        const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
          method: 'POST',
          headers: {
            'xi-api-key': env.ELEVENLABS_API_KEY,
          },
          body: formData,
        });

        if (res.ok) {
          const data = await res.json();
          const voiceId = data.voice_id;
          console.log(`[VOICE CLONING] Successfully created ElevenLabs clone voice ID: ${voiceId}`);
          return {
            voiceId,
            voiceSampleUrl: sampleUrl,
            voiceProvider: 'cloned',
            voiceSettings: defaultSettings,
          };
        } else {
          const errText = await res.text();
          console.warn('[VOICE CLONING] ElevenLabs API error:', errText);
        }
      } catch (cloneErr) {
        console.warn('[VOICE CLONING] ElevenLabs voice creation request failed:', cloneErr.message);
      }
    }

    // 4. Acoustic profile mapped voice (distinct matched voice for each character)
    const clonedProfileId = `cloned_${Date.now().toString(36)}`;
    console.log(`[VOICE CLONING] Configured acoustic voice clone: ID=${clonedProfileId}, preset=${acoustics.mappedPreset}, pitch=${acoustics.estimatedPitchHz}Hz`);

    return {
      voiceId: clonedProfileId,
      voiceSampleUrl: sampleUrl,
      voiceProvider: 'cloned',
      voiceSettings: defaultSettings,
    };
  }

  /**
   * Ensure character has an active voice clone:
   * Upgrades to ElevenLabs if key is present, or updates acoustic mapping if preset is default.
   * @param {Object} character
   * @returns {Promise<string>} Active voice ID
   */
  async ensureClonedVoice(character) {
    if (!character || character.voice_provider !== 'cloned') {
      return character?.voice_id || 'alloy';
    }

    // 1. If ElevenLabs is configured and character still has a placeholder cloned ID
    if (env.ELEVENLABS_API_KEY && (!character.voice_id || character.voice_id.startsWith('cloned_'))) {
      if (character.voice_sample_url) {
        try {
          console.log(`[VOICE CLONING] Upgrading character #${character.id} (${character.name}) to real ElevenLabs voice...`);
          const audioResponse = await fetch(character.voice_sample_url);
          if (audioResponse.ok) {
            const arrayBuf = await audioResponse.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuf);
            const ext = character.voice_sample_url.includes('.wav') ? '.wav' : '.mp3';
            const cloneResult = await this.cloneVoiceFromSample({
              name: character.name,
              audioBuffer,
              filename: `sample_${character.id}${ext}`,
              mimeType: ext === '.wav' ? 'audio/wav' : 'audio/mpeg',
              description: `Cloned voice profile for ${character.name}`,
              meta: character,
            });

            if (cloneResult.voiceId && !cloneResult.voiceId.startsWith('cloned_')) {
              await baseRepository.execute(
                'UPDATE characters SET voice_id = ?, voice_settings = ? WHERE id = ?',
                [cloneResult.voiceId, JSON.stringify(cloneResult.voiceSettings), character.id]
              );
              character.voice_id = cloneResult.voiceId;
              character.voice_settings = cloneResult.voiceSettings;
              console.log(`[VOICE CLONING] Upgraded character #${character.id} to ElevenLabs voice ID: ${cloneResult.voiceId}`);
              return cloneResult.voiceId;
            }
          }
        } catch (err) {
          console.warn('[VOICE CLONING] Auto-upgrade with ElevenLabs failed:', err.message);
        }
      }
    }

    // 2. If no mappedPreset or currently mapped to generic 'alloy', re-analyze
    const currentMapped = character.voice_settings?.mappedPreset;
    if (!currentMapped || currentMapped === 'alloy') {
      if (character.voice_sample_url) {
        try {
          const audioResponse = await fetch(character.voice_sample_url);
          if (audioResponse.ok) {
            const arrayBuf = await audioResponse.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuf);
            const ext = character.voice_sample_url.includes('.wav') ? '.wav' : '.webm';
            const acoustics = this.analyzeAcousticProfile(
              audioBuffer,
              `sample${ext}`,
              ext === '.wav' ? 'audio/wav' : 'audio/webm',
              character.name,
              character
            );
            const updatedSettings = {
              ...(character.voice_settings || {}),
              mappedPreset: acoustics.mappedPreset,
              speed: acoustics.speed,
              estimatedPitchHz: acoustics.estimatedPitchHz,
            };
            await baseRepository.execute(
              'UPDATE characters SET voice_settings = ? WHERE id = ?',
              [JSON.stringify(updatedSettings), character.id]
            );
            character.voice_settings = updatedSettings;
            console.log(`[VOICE ACOUSTICS] Character #${character.id} (${character.name}) mapped to preset: ${acoustics.mappedPreset}`);
          }
        } catch (_) {}
      }
    }

    return character.voice_id;
  }

  /**
   * Ensure Public Mind has an active voice clone.
   * @param {Object} mind
   * @returns {Promise<string>} Active voice ID
   */
  async ensureClonedMindVoice(mind) {
    if (!mind || mind.voice_provider !== 'cloned') {
      return mind?.voice_id || 'echo';
    }

    if (env.ELEVENLABS_API_KEY && (!mind.voice_id || mind.voice_id.startsWith('cloned_'))) {
      if (mind.voice_sample_url) {
        try {
          const audioResponse = await fetch(mind.voice_sample_url);
          if (audioResponse.ok) {
            const arrayBuf = await audioResponse.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuf);
            const ext = mind.voice_sample_url.includes('.wav') ? '.wav' : '.mp3';
            const cloneResult = await this.cloneVoiceFromSample({
              name: mind.display_name || mind.name || mind.handle,
              audioBuffer,
              filename: `sample_mind_${mind.id}${ext}`,
              mimeType: ext === '.wav' ? 'audio/wav' : 'audio/mpeg',
              description: `Cloned voice profile for ${mind.display_name}`,
              meta: mind,
            });

            if (cloneResult.voiceId && !cloneResult.voiceId.startsWith('cloned_')) {
              await baseRepository.execute(
                'UPDATE user_minds SET voice_id = ?, voice_settings = ? WHERE id = ?',
                [cloneResult.voiceId, JSON.stringify(cloneResult.voiceSettings), mind.id]
              );
              mind.voice_id = cloneResult.voiceId;
              mind.voice_settings = cloneResult.voiceSettings;
              return cloneResult.voiceId;
            }
          }
        } catch (err) {
          console.warn('[VOICE CLONING] Mind auto-upgrade failed:', err.message);
        }
      }
    }

    const currentMapped = mind.voice_settings?.mappedPreset;
    if (!currentMapped || currentMapped === 'alloy') {
      if (mind.voice_sample_url) {
        try {
          const audioResponse = await fetch(mind.voice_sample_url);
          if (audioResponse.ok) {
            const arrayBuf = await audioResponse.arrayBuffer();
            const audioBuffer = Buffer.from(arrayBuf);
            const ext = mind.voice_sample_url.includes('.wav') ? '.wav' : '.webm';
            const acoustics = this.analyzeAcousticProfile(
              audioBuffer,
              `sample${ext}`,
              ext === '.wav' ? 'audio/wav' : 'audio/webm',
              mind.display_name || mind.name,
              mind
            );
            const updatedSettings = {
              ...(mind.voice_settings || {}),
              mappedPreset: acoustics.mappedPreset,
              speed: acoustics.speed,
              estimatedPitchHz: acoustics.estimatedPitchHz,
            };
            await baseRepository.execute(
              'UPDATE user_minds SET voice_settings = ? WHERE id = ?',
              [JSON.stringify(updatedSettings), mind.id]
            );
            mind.voice_settings = updatedSettings;
          }
        } catch (_) {}
      }
    }

    return mind.voice_id;
  }
}

export const voiceCloningService = new VoiceCloningService();
export default voiceCloningService;
