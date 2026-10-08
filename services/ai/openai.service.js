import openai from '../../config/openai.js';
import env from '../../config/env.js';
import { getCurrentTimeContext, getHumanTimeAnchor } from './temporal.utils.js';

function isNetworkOrQuotaError(error) {
  if (!error) return false;
  return (
    error.status === 429 ||
    error.status === 401 ||
    error.code === 'ENOTFOUND' ||
    error.name === 'APIConnectionError' ||
    error.cause?.code === 'ENOTFOUND' ||
    error.cause?.code === 'ECONNREFUSED' ||
    error.cause?.code === 'ETIMEDOUT' ||
    (typeof error.message === 'string' &&
      (error.message.includes('Connection error') ||
       error.message.includes('ENOTFOUND') ||
       error.message.includes('fetch failed')))
  );
}

/**
 * OpenAiService
 * Direct OpenAI Chat Completion and Real-Time SSE Streaming integration
 * with Socratic mentorship conversational pacing and calibrated memory extraction.
 */
export class OpenAiService {
  /**
   * Execute chat completion (non-streaming).
   * Enforces Socratic conversational pacing via calibrated temperature (0.65) and max_tokens (300).
   */
  async generateChatCompletion({
    messages,
    model = env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature = 0.65,
    max_tokens = 300,
  }) {
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'dummy-key-offline') {
      return this.generateOfflineSimulation(messages);
    }

    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens,
      });

      const choice = response.choices?.[0];
      const content = choice?.message?.content || '';
      const usage = response.usage || {};

      return {
        content,
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      };
    } catch (error) {
      console.error('[OPENAI SERVICE ERROR]', error.message);
      if (isNetworkOrQuotaError(error)) {
        return this.generateOfflineSimulation(messages, error.message);
      }
      throw error;
    }
  }

  /**
   * Create real-time streaming chat completion.
   * Yields text chunks as they arrive.
   * Enforces conversational pacing via default max_tokens (300) and temperature (0.65).
   * @param {Object} params
   * @param {Array} params.messages
   * @param {string} [params.model]
   * @param {number} [params.temperature=0.65]
   * @param {number} [params.max_tokens=300]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<AsyncIterable<string>>}
   */
  async createChatStream({
    messages,
    model = env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature = 0.65,
    max_tokens = 300,
    signal,
  }) {
    // If no valid OpenAI key, return an offline async generator yielding simulated words
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'dummy-key-offline') {
      return this.createOfflineStreamSimulation(messages, signal);
    }

    try {
      const stream = await openai.chat.completions.create(
        {
          model,
          messages,
          temperature,
          max_tokens,
          stream: true,
        },
        { signal }
      );

      // Wrap OpenAI stream into an async generator yielding text deltas
      return (async function* () {
        for await (const chunk of stream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            yield delta;
          }
        }
      })();
    } catch (error) {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        console.log('[OPENAI STREAM] Request was aborted by client.');
        return (async function* () {})();
      }
      console.error('[OPENAI STREAM ERROR]', error.message);
      if (isNetworkOrQuotaError(error)) {
        return this.createOfflineStreamSimulation(messages, signal, error.message);
      }
      throw error;
    }
  }

  /**
   * Extract user memories (goals, blockers, facts, emotional states, shared events) from recent turns.
   * Maps memory to conversation date and time anchor just like real human episodic memory.
   * @param {Object} params
   * @param {string} params.characterName
   * @param {Array<{sender_type: string, content: string}>} params.recentTurns
   * @param {Date|string} [params.conversationTimestamp]
   * @returns {Promise<Array<{ memoryType: string, category: string, content: string, importanceScore: number, temporalAnchor: string }>>}
   */
  async extractMemories({ characterName, recentTurns, conversationTimestamp = new Date() }) {
    if (!recentTurns || recentTurns.length === 0) return [];

    const timeCtx = getCurrentTimeContext(conversationTimestamp);

    const turnsText = recentTurns
      .map((t) => `${t.sender_type === 'user' ? 'User' : characterName}: ${t.content}`)
      .join('\n');

    const prompt = `
Analyze the following recent conversation between the User and ${characterName}.
Conversation Time & Date: ${timeCtx.fullDateTime} (Day: ${timeCtx.dayOfWeek})
Calendar Date: ${timeCtx.calendarDate}

Extract distinct enduring memories that were EXPLICITLY REVEALED BY THE USER during this interaction.

CRITICAL ANTI-HALLUCINATION RULES:
1. ONLY extract facts, goals, preferences, constraints, or feelings that the USER explicitly stated in their messages.
2. NEVER extract fictional anecdotes, past events, or claims made up by ${characterName}. If ${characterName} mentions an event that the user did not say, DO NOT treat it as a memory.
3. DO NOT invent, extrapolate, or assume facts not directly stated by the User.
4. If the user did not reveal any genuine new personal fact, goal, emotional state, or preference, return an empty array: []

Listen specifically for:
1. User's stated goals, core ambitions, and project objectives.
   - Tag as category: "goal" with high importance: 4 or 5.
   - Example: "User wants to build an AI app", "User plans to launch a B2B platform".
2. User's revealed blockers, real bottlenecks, and underlying constraints.
   - Example: "User's real issue is lack of distribution, not product features", "User is struggling with customer validation before writing code".
   - Tag as category: "goal" or category: "fact" with high importance: 4 or 5.
3. User facts, habits, job, location, and life circumstances explicitly stated by the user (category: "fact" or "preference").
4. Emotional states, vulnerability, stress, grief, joy, or relationship dynamics expressed by the user (category: "relationship" or "fact", memoryType: "emotional_state").
5. Real shared experiences or milestones explicitly confirmed and stated by the User (memoryType: "shared_event", category: "event").

Classify each memory into:
1. "memoryType": one of ["user_fact", "emotional_state", "shared_event"]
   - "user_fact": An enduring fact, goal, revealed blocker, habit, or life context stated by the user.
   - "emotional_state": Current or recurring emotional feelings, vulnerability, stress, grief, joy expressed by user.
   - "shared_event": An experience or milestone explicitly confirmed and stated by the User.
2. "category": one of ["goal", "fact", "preference", "relationship", "event"]
   - NOTE: User's stated goals, root constraints, and revealed blockers MUST be categorized as "goal" or "fact".
3. "content": concise factual statement in 3rd person capturing what the USER stated (e.g., "User's real issue is lack of distribution, not product features", "User wants to build an AI app but does not know where to start").
4. "importanceScore": integer from 1 to 5.
5. "temporalAnchor": temporal semantic anchor relative to the conversation date (${timeCtx.calendarDate}):
   - "today": if event/statement relates to today.
   - "yesterday": if user explicitly refers to yesterday.
   - "recent_days": if user refers to recent days or this week.
   - "past_event": if user refers to an earlier past life milestone or history.
   - "future_goal": if user states an upcoming plan (e.g. tomorrow, next week, future).
   - "ongoing": if user expresses a general persistent habit, preference, or enduring fact.

If nothing notable was revealed by the user, return an empty array: []

Return a JSON object in this format:
{
  "memories": [
    {
      "memoryType": "user_fact",
      "category": "goal",
      "content": "User wants to build an AI app but does not know where to start",
      "importanceScore": 5,
      "temporalAnchor": "future_goal"
    }
  ]
}

Conversation:
${turnsText}
`.trim();

    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'dummy-key-offline') {
      return this.extractMemoriesOffline(recentTurns);
    }

    try {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.items || []);
      
      const validCategories = new Set(['goal', 'fact', 'preference', 'relationship', 'event']);
      const validTypes = new Set(['user_fact', 'emotional_state', 'shared_event', 'persona_anchor']);

      return items
        .filter((item) => item.content)
        .map((item) => {
          const cat = validCategories.has(item.category) ? item.category : 'fact';
          const memType = validTypes.has(item.memoryType) ? item.memoryType : (cat === 'event' ? 'shared_event' : 'user_fact');
          let score = parseInt(item.importanceScore, 10) || 3;
          if (cat === 'goal' || cat === 'relationship' || memType === 'emotional_state') {
            score = Math.max(4, score);
          }

          return {
            memoryType: memType,
            category: cat,
            content: String(item.content).trim(),
            importanceScore: Math.min(5, Math.max(1, score)),
            temporalAnchor: item.temporalAnchor || 'today',
          };
        });
    } catch (error) {
      console.warn('[MEMORY EXTRACTION ERROR]', error.message);
      return this.extractMemoriesOffline(recentTurns);
    }
  }

  /**
   * Condense older conversation messages into a rolling narrative summary.
   * @param {Object} params
   * @param {string} params.characterName
   * @param {string} [params.previousSummary]
   * @param {Array} params.olderMessages
   * @returns {Promise<string>} Updated condensed summary
   */
  async condenseSummary({ characterName, previousSummary = '', olderMessages = [] }) {
    if (!olderMessages || olderMessages.length === 0) return previousSummary;

    const messagesText = olderMessages
      .map((m) => `${m.sender_type === 'user' ? 'User' : characterName}: ${m.content}`)
      .join('\n');

    const prompt = `
You are condensing a conversation history between the User and ${characterName}.
${previousSummary ? `Previous Summary of Earlier Conversation:\n${previousSummary}\n` : ''}

New Messages to incorporate into the summary:
${messagesText}

Instructions:
Write an updated, highly cohesive, condensed narrative summary of the key subjects discussed, decisions made, personal stories shared, and emotional dynamics between User and ${characterName}.
Keep it under 200 words. Focus strictly on narrative context and essential dialogue continuity.
`.trim();

    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === 'dummy-key-offline') {
      const topics = olderMessages.map((m) => m.content.slice(0, 30)).join('; ');
      return `${previousSummary ? previousSummary + ' ' : ''}User and ${characterName} previously discussed: ${topics}.`;
    }

    try {
      const response = await openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      return response.choices?.[0]?.message?.content?.trim() || previousSummary;
    } catch (error) {
      console.warn('[SUMMARY CONDENSATION ERROR]', error.message);
      return previousSummary;
    }
  }

  /**
   * Offline heuristic memory extractor for development environments.
   * Calibrated to extract user goals, constraints, and revealed blockers.
   */
  extractMemoriesOffline(recentTurns) {
    const userTexts = recentTurns
      .filter((t) => t.sender_type === 'user')
      .map((t) => t.content)
      .join(' ');

    const memories = [];

    // Goals & ambitions
    const goalMatch = userTexts.match(/(?:i want to build|i want to make|i am trying to|my goal is|i plan to|i want to)\s+([^.?!,]+)/i);
    if (goalMatch) {
      memories.push({
        memoryType: 'user_fact',
        category: 'goal',
        content: `User wants to ${goalMatch[1].trim()}`,
        importanceScore: 5,
      });
    }

    // Constraints & blockers
    const blockerMatch = userTexts.match(/(?:don't know where to start|i don't know|struggling with|my problem is|bottleneck is|stuck on|hardest part is|real bottleneck is|real issue is)\s+([^.?!,]+)/i);
    if (blockerMatch) {
      memories.push({
        memoryType: 'user_fact',
        category: 'goal',
        content: `User is blocked on: ${blockerMatch[0].trim()}`,
        importanceScore: 5,
      });
    }

    // Distribution / customer specific blocker check
    if (userTexts.toLowerCase().includes('distribution') || userTexts.toLowerCase().includes('paying customer')) {
      memories.push({
        memoryType: 'user_fact',
        category: 'goal',
        content: "User's real bottleneck is lack of distribution and paying customers",
        importanceScore: 5,
      });
    }

    // Preferences
    const preferenceMatch = userTexts.match(/(?:my favorite|i like|i love|i prefer)\s+([^.?!,]+)/i);
    if (preferenceMatch) {
      memories.push({
        memoryType: 'user_fact',
        category: 'preference',
        content: `User enjoys ${preferenceMatch[1].trim()}`,
        importanceScore: 4,
      });
    }

    // Facts
    const factMatch = userTexts.match(/(?:i am a|i work as|my job is|i live in|my name is)\s+([^.?!,]+)/i);
    if (factMatch) {
      memories.push({
        memoryType: 'user_fact',
        category: 'fact',
        content: `User stated: ${factMatch[0].trim()}`,
        importanceScore: 4,
      });
    }

    return memories;
  }

  /**
   * Offline streaming generator simulation with Socratic pacing (2-3 punchy sentences).
   */
  async *createOfflineStreamSimulation(messages, signal, errorHint = '') {
    if (errorHint) console.warn('[OFFLINE STREAM SIMULATION ACTIVE]', errorHint);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || 'Hello';
    const lower = lastUserMessage.toLowerCase();

    let fullResponse;
    if (lower.includes('build an ai app') || lower.includes('where to start')) {
      fullResponse = "Most people start with the tech and fail before they write a line of code. What's the specific, painful problem you're trying to solve that someone will actually pay you money for right now?";
    } else if (lower.includes('landing page') || lower.includes('dm')) {
      fullResponse = "Cold messaging ten ideal users gives you real feedback in hours, whereas landing pages just test copy. Who is the exact customer you plan to reach out to first?";
    } else {
      fullResponse = "Boil this down to first principles. What is the single constraint you need to solve right now before doing anything else?";
    }

    const words = fullResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      if (signal?.aborted) break;
      yield words[i] + (i < words.length - 1 ? ' ' : '');
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  generateOfflineSimulation(messages, errorHint = '') {
    if (errorHint) console.warn('[OFFLINE SIMULATION ACTIVE]', errorHint);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || 'Hello';
    const lower = lastUserMessage.toLowerCase();

    let simulatedContent;
    if (lower.includes('build an ai app') || lower.includes('where to start')) {
      simulatedContent = "Most people start with the tech and fail before they write a line of code. What's the specific, painful problem you're trying to solve that someone will actually pay you money for right now?";
    } else if (lower.includes('distribution') || lower.includes('landing page') || lower.includes('dm')) {
      simulatedContent = "Forget landing pages. Go find ten prospective buyers on Twitter or LinkedIn today and ask what's costing them time or money every week. What exact role or job title feels this pain the sharpest?";
    } else {
      simulatedContent = "Boil this down to the core bottleneck rather than reasoning by analogy. What is the single most critical constraint preventing progress right now?";
    }

    const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
    return {
      content: simulatedContent,
      promptTokens: Math.ceil(systemPrompt.length / 4),
      completionTokens: Math.ceil(simulatedContent.length / 4),
      totalTokens: Math.ceil((systemPrompt.length + simulatedContent.length) / 4),
    };
  }
}

export const openAiService = new OpenAiService();
export default openAiService;
