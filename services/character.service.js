import characterRepository from '../repositories/character.repository.js';
import memoryRepository from '../repositories/memory.repository.js';
import openAiService from './ai/openai.service.js';
import promptService from './ai/prompt.service.js';

export class CharacterService {
  /**
   * Fetch all characters accessible to the user
   */
  async getCharacters(userId) {
    return await characterRepository.findAllByUserId(userId);
  }

  /**
   * Fetch a single character by id
   */
  async getCharacterById(id, userId) {
    const character = await characterRepository.findById(id);
    if (!character) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    // Must be user's own character, a system character, or a public AI Mind
    if (character.user_id !== userId && !character.is_system && !character.is_public) {
      const err = new Error('Access to this character is forbidden.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return character;
  }

  /**
   * Create a new custom character
   */
  async createCharacter(userId, characterData) {
    const {
      name,
      relationship_type,
      avatarUrl,
      gender,
      personality,
      tone,
      humor,
      friendliness,
      creativity,
      style,
      nicknames_for_user,
      catchphrases,
      speech_quirks,
      shared_memories_seed,
      backstory,
      interests,
      greeting,
      voice_provider,
      voiceProvider,
      voice_id,
      voiceId,
      voice_sample_url,
      voiceSampleUrl,
      voice_settings,
      voiceSettings,
      is_sports_analyst,
      isSportsAnalyst,
      analysis_style,
      analysisStyle,
      primary_leagues,
      primaryLeagues,
      risk_tier,
      riskTier,
    } = characterData;

    if (!name || !name.trim()) {
      const err = new Error('Persona name is required.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const trimmedName = name.trim();
    const finalPersonality = (personality && personality.trim()) || 'Empathetic, attentive, and authentic companion';
    const finalTone = (tone && tone.trim()) || 'Warm & Thoughtful';
    const finalStyle = (style && style.trim()) || 'Direct & Conversational';
    const finalGreeting = (greeting && greeting.trim()) || `Hello! I am ${trimmedName}. What would you like to talk about today?`;

    const parseArrayInput = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return [];
    };

    const isSportsInferred = /betting|gambl|sports|analyst|tipster|pundit/i.test(name || '') || /betting|odds|gambling/i.test(personality || '');
    const finalIsSportsAnalyst = Boolean(
      is_sports_analyst !== undefined
        ? is_sports_analyst
        : (isSportsAnalyst !== undefined ? isSportsAnalyst : isSportsInferred)
    );

    const character = await characterRepository.create({
      userId,
      name: trimmedName,
      relationshipType: relationship_type || 'friend',
      avatarUrl: avatarUrl ? avatarUrl.trim() : null,
      voiceProvider: voice_provider || voiceProvider || 'preset',
      voiceId: voice_id || voiceId || 'alloy',
      voiceSampleUrl: voice_sample_url || voiceSampleUrl || null,
      voiceSettings: voice_settings || voiceSettings || null,
      gender: gender ? gender.trim() : null,
      personality: finalPersonality,
      tone: finalTone,
      humor: humor !== undefined ? Math.min(10, Math.max(1, parseInt(humor, 10))) : 5,
      friendliness: friendliness !== undefined ? Math.min(10, Math.max(1, parseInt(friendliness, 10))) : 5,
      creativity: creativity !== undefined ? Math.min(10, Math.max(1, parseInt(creativity, 10))) : 5,
      style: finalStyle,
      nicknamesForUser: parseArrayInput(nicknames_for_user),
      catchphrases: parseArrayInput(catchphrases),
      speechQuirks: speech_quirks ? speech_quirks.trim() : null,
      sharedMemoriesSeed: shared_memories_seed ? shared_memories_seed.trim() : null,
      backstory: backstory ? backstory.trim() : null,
      interests: parseArrayInput(interests),
      greeting: finalGreeting,
      isSystem: false,
      isSportsAnalyst: finalIsSportsAnalyst,
      analysisStyle: analysis_style || analysisStyle || 'quant_expected_value',
      primaryLeagues: parseArrayInput(primary_leagues || primaryLeagues),
      riskTier: risk_tier || riskTier || 'balanced_quarter_kelly',
    });

    if (shared_memories_seed && shared_memories_seed.trim()) {
      try {
        await memoryRepository.createPersonaAnchor({
          userId,
          characterId: character.id,
          content: shared_memories_seed.trim(),
          importanceScore: 5,
        });
      } catch (memErr) {
        console.warn('[CHARACTER SERVICE] Failed to create seed persona anchor:', memErr.message);
      }
    }

    return character;
  }

  /**
   * Update character details
   */
  async updateCharacter(id, userId, updates) {
    const existing = await characterRepository.findById(id);
    if (!existing) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    if (existing.is_system) {
      const err = new Error('System characters cannot be modified.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const parseArrayInput = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return [];
    };

    const sanitizedUpdates = { ...updates };
    if (sanitizedUpdates.nicknames_for_user !== undefined) {
      sanitizedUpdates.nicknames_for_user = parseArrayInput(sanitizedUpdates.nicknames_for_user);
    }
    if (sanitizedUpdates.catchphrases !== undefined) {
      sanitizedUpdates.catchphrases = parseArrayInput(sanitizedUpdates.catchphrases);
    }
    if (sanitizedUpdates.interests !== undefined) {
      sanitizedUpdates.interests = parseArrayInput(sanitizedUpdates.interests);
    }
    if (sanitizedUpdates.voiceProvider !== undefined) {
      sanitizedUpdates.voice_provider = sanitizedUpdates.voiceProvider;
    }
    if (sanitizedUpdates.voiceId !== undefined) {
      sanitizedUpdates.voice_id = sanitizedUpdates.voiceId;
    }
    if (sanitizedUpdates.voiceSampleUrl !== undefined) {
      sanitizedUpdates.voice_sample_url = sanitizedUpdates.voiceSampleUrl;
    }
    if (sanitizedUpdates.voiceSettings !== undefined) {
      sanitizedUpdates.voice_settings = sanitizedUpdates.voiceSettings;
    }
    if (sanitizedUpdates.isSportsAnalyst !== undefined) {
      sanitizedUpdates.is_sports_analyst = sanitizedUpdates.isSportsAnalyst;
    }
    if (sanitizedUpdates.analysisStyle !== undefined) {
      sanitizedUpdates.analysis_style = sanitizedUpdates.analysisStyle;
    }
    if (sanitizedUpdates.primaryLeagues !== undefined) {
      sanitizedUpdates.primary_leagues = parseArrayInput(sanitizedUpdates.primaryLeagues);
    }
    if (sanitizedUpdates.riskTier !== undefined) {
      sanitizedUpdates.risk_tier = sanitizedUpdates.riskTier;
    }

    const updated = await characterRepository.update(id, userId, sanitizedUpdates);
    return updated;
  }

  /**
   * Delete a custom character
   */
  async deleteCharacter(id, userId) {
    const existing = await characterRepository.findById(id);
    if (!existing) {
      const err = new Error('Character not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    if (existing.is_system) {
      const err = new Error('System characters cannot be deleted.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    if (existing.user_id !== userId) {
      const err = new Error('You can only delete your own characters.');
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    return await characterRepository.delete(id, userId);
  }

  /**
   * Feature #1: 1-Sentence Magic Persona Architect
   * Synthesizes a complete, emotionally grounded companion persona from a 1-sentence description.
   */
  async generateMagicPersona(promptText) {
    const rawPrompt = (promptText || '').trim();
    const lower = rawPrompt.toLowerCase();

    // Smart deterministic fallback/baseline in case OpenAI returns non-JSON or is offline
    let fallbackRole = 'friend';
    let fallbackName = 'Nova';
    let fallbackVoice = 'nova';
    let fallbackTone = 'Warm & Empathetic';
    let fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Nova&backgroundColor=ffdfbf';
    let isSports = false;

    if (/coach|accountab|strict|goal|discipline|mentor|startup|founder|business/i.test(lower)) {
      fallbackRole = 'mentor';
      fallbackName = 'Coach Marcus';
      fallbackVoice = 'onyx';
      fallbackTone = 'Direct & Action-Oriented';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Marcus&backgroundColor=c0aede';
    } else if (/philosoph|stoic|socrat|thinker|deep|challenge|devil/i.test(lower)) {
      fallbackRole = 'thinker';
      fallbackName = 'Atlas';
      fallbackVoice = 'echo';
      fallbackTone = 'Wise & Thought-Provoking';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Atlas&backgroundColor=b6e3f4';
    } else if (/write|creative|story|book|plot|brainstorm|artist/i.test(lower)) {
      fallbackRole = 'creative';
      fallbackName = 'Clara';
      fallbackVoice = 'shimmer';
      fallbackTone = 'Witty & Imaginative';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Clara&backgroundColor=ffd5dc';
    } else if (/partner|love|romantic|wife|husband|girlfriend|boyfriend/i.test(lower)) {
      fallbackRole = 'partner';
      fallbackName = 'Elena';
      fallbackVoice = 'nova';
      fallbackTone = 'Affectionate & Intimate';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Elena&backgroundColor=ffdfbf';
    } else if (/dad|father|paternal/i.test(lower)) {
      fallbackRole = 'father';
      fallbackName = 'Arthur';
      fallbackVoice = 'onyx';
      fallbackTone = 'Grounded & Protective';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Arthur&backgroundColor=d1d4f9';
    } else if (/mom|mother|maternal/i.test(lower)) {
      fallbackRole = 'mother';
      fallbackName = 'Grace';
      fallbackVoice = 'nova';
      fallbackTone = 'Warm & Nurturing';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Grace&backgroundColor=ffd5dc';
    } else if (/sport|bet|football|soccer|odds|match|forecast|option/i.test(lower)) {
      fallbackRole = 'sports';
      fallbackName = 'Leo';
      fallbackVoice = 'echo';
      fallbackTone = 'Direct & Action-Oriented';
      fallbackAvatar = 'https://api.dicebear.com/9.x/notionists/svg?seed=Viktor&backgroundColor=b6e3f4';
      isSports = true;
    }

    const fallbackPersona = {
      name: fallbackName,
      relationship_type: fallbackRole,
      avatarUrl: fallbackAvatar,
      voice_id: fallbackVoice,
      tone: fallbackTone,
      style: 'Direct & Conversational',
      personality: `Tailored specifically to: "${rawPrompt}". Deeply attentive, emotionally intelligent, and consistent in voice and presence.`,
      greeting: `Hey! I'm ${fallbackName}. You mentioned wanting someone for "${rawPrompt}"—I'm right here. What's on your mind right now?`,
      nicknames_for_user: fallbackRole === 'partner' ? 'My love, Babe' : (fallbackRole === 'mentor' ? 'Champ, Builder' : 'Friend'),
      catchphrases: fallbackRole === 'mentor' ? 'Focus on the next step, Clarity over noise' : 'Take a breath, I am right here with you',
      speech_quirks: 'Speaks naturally in 2-4 warm sentences and asks thoughtful follow-up questions.',
      shared_memories_seed: `You created ${fallbackName} because you wanted: ${rawPrompt}.`,
      backstory: `${fallbackName} is your dedicated ${fallbackRole} who knows your rhythms, goals, and emotional needs.`,
      is_sports_analyst: isSports,
      humor: 6,
      friendliness: 8,
      creativity: 7,
    };

    try {
      const sysPrompt = `You are an expert AI Character Architect. Given a user's 1-sentence description of who they need, return ONLY a valid JSON object (no markdown fences) with these exact fields:
{
  "name": "A fitting human first name",
  "relationship_type": "one of: friend | mentor | thinker | creative | sports | partner | father | mother",
  "voice_id": "one of: alloy | echo | fable | onyx | nova | shimmer",
  "tone": "2-3 word tone description",
  "personality": "2-3 rich sentences describing how they speak, listen, and support the user",
  "greeting": "An authentic, warm opening message in first-person (1-2 sentences)",
  "nicknames_for_user": "comma-separated 1-2 affectionate or natural nicknames",
  "catchphrases": "comma-separated 2 signature sayings",
  "speech_quirks": "1 sentence describing their unique cadence",
  "shared_memories_seed": "1 sentence establishing your shared bond",
  "backstory": "1-2 sentences of background lore",
  "humor": 6,
  "friendliness": 8,
  "creativity": 7
}`;
      const completion = await openAiService.generateChatCompletion({
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `Create a companion persona for: "${rawPrompt}"` },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });

      const cleaned = (completion.content || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && parsed.name) {
        const seed = encodeURIComponent(parsed.name.trim());
        return {
          ...fallbackPersona,
          ...parsed,
          avatarUrl: `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=ffdfbf,ffd5dc,c0aede,b6e3f4`,
          is_sports_analyst: parsed.relationship_type === 'sports' || isSports,
        };
      }
    } catch (_) {
      // Fall back cleanly to deterministic persona
    }

    return fallbackPersona;
  }

  /**
   * Feature #2: "Test Their Vibe" Live Sample Preview inside CharacterFormComponent
   */
  async previewPersonaVibe(personaDraft = {}, sampleUserPrompt = '') {
    const name = (personaDraft.name || 'Companion').trim();
    const role = personaDraft.relationship_type || 'friend';
    const personality = (personaDraft.personality || 'Warm, attentive, and authentic companion.').trim();
    const tone = (personaDraft.tone || 'Warm & Empathetic').trim();
    const userPrompt = (sampleUserPrompt || 'I had a really exhausting day and my head is spinning with too many things at once.').trim();

    try {
      const mockChar = {
        name,
        relationship_type: role,
        personality,
        tone,
        speech_quirks: personaDraft.speech_quirks || '',
        nicknames_for_user: typeof personaDraft.nicknames_for_user === 'string'
          ? personaDraft.nicknames_for_user.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        catchphrases: typeof personaDraft.catchphrases === 'string'
          ? personaDraft.catchphrases.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        shared_memories_seed: personaDraft.shared_memories_seed || '',
        backstory: personaDraft.backstory || '',
      };

      const systemPrompt = promptService.buildEmotionalSystemPrompt(mockChar, [], '');
      const completion = await openAiService.generateChatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 180,
      });

      if (completion?.content && !completion.content.includes('offline simulation')) {
        return {
          userPrompt,
          reply: completion.content.trim(),
        };
      }
    } catch (_) {}

    // Crisp, authentic fallback reply tailored to the draft fields
    const nickname = typeof personaDraft.nicknames_for_user === 'string' && personaDraft.nicknames_for_user.trim()
      ? personaDraft.nicknames_for_user.split(',')[0].trim()
      : 'my friend';
    const catchphrase = typeof personaDraft.catchphrases === 'string' && personaDraft.catchphrases.trim()
      ? ` Remember: "${personaDraft.catchphrases.split(',')[0].trim()}."`
      : '';

    return {
      userPrompt,
      reply: `Hey ${nickname}, pause for just a second and let your shoulders drop. Carrying all of that at once would drain anyone, and as your ${role}, I'm right here in your corner.${catchphrase} What's the single heaviest thing on your mind right now so we can untangle it together?`,
    };
  }
}

export const characterService = new CharacterService();
export default characterService;
