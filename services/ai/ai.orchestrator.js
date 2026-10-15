import characterRepository from '../../repositories/character.repository.js';
import conversationRepository from '../../repositories/conversation.repository.js';
import messageRepository from '../../repositories/message.repository.js';
import promptService from './prompt.service.js';
import openAiService from './openai.service.js';
import memoryService from './memory.service.js';
import summaryService from './summary.service.js';
import mindRepository from '../../repositories/mind.repository.js';
import sportsRepository from '../../repositories/sports.repository.js';
import sportsApiService from '../sports/sports-api.service.js';
import quantService from '../sports/quant.service.js';
import { extractMatchFromText, detectTiltIntent, detectSportsIntent } from '../sports/sports-detector.js';

export const sportsToolDefinition = {
  type: "function",
  function: {
    name: "get_sports_betting_intel",
    description: "Fetch live managers, verified lineups, injuries, bookmaker odds, and quant signals for upcoming or lookahead matches.",
    parameters: {
      type: "object",
      properties: {
        home_team: { type: "string", description: "Home team name" },
        away_team: { type: "string", description: "Away team name" },
        is_lookahead: { type: "boolean", description: "True if match is over 5 days away" }
      },
      required: ["home_team", "away_team"]
    }
  }
};

/**
 * AiOrchestrator
 * Coordinates personality prompt hydration, long-term memory recall,
 * rolling summarization, real-time SSE streaming, and background intelligence workers.
 */
export class AiOrchestrator {
  /**
   * Stream a real-time conversational turn via Server-Sent Events (SSE).
   * @param {Object} params
   * @param {number|string} params.userId
   * @param {number|string} params.characterId
   * @param {number|string} [params.conversationId]
   * @param {string} params.content - User message text
   * @param {(chunk: string) => void} params.onChunk - Callback invoked on each text token
   * @param {(result: Object) => void} params.onDone - Callback invoked upon stream completion
   * @param {AbortSignal} [params.signal] - Client disconnect abort signal
   */
  async streamChatTurn({
    userId,
    characterId,
    conversationId,
    content,
    conversationMode = 'default',
    onChunk,
    onDone,
    signal,
  }) {
    // 1. Verify character existence and access authorization
    const character = await characterRepository.findById(characterId);
    if (!character) {
      const err = new Error('Character companion not found.');
      err.statusCode = 404;
      err.code = 'CHARACTER_NOT_FOUND';
      throw err;
    }

    const isOwner = character.user_id === userId;
    const isPublic = Boolean(character.is_public);
    const isSystem = Boolean(character.is_system);

    if (!isOwner && !isSystem && !isPublic) {
      const isSubscribed = await mindRepository.isSubscribed(userId, characterId);
      if (!isSubscribed) {
        const err = new Error('Access denied to this character.');
        err.statusCode = 403;
        err.code = 'FORBIDDEN';
        throw err;
      }
    }

    // 2. Fetch or initialize conversation
    let conversation;
    if (conversationId) {
      conversation = await conversationRepository.findById(conversationId, userId);
      if (!conversation) {
        const err = new Error('Conversation session not found or unauthorized.');
        err.statusCode = 404;
        err.code = 'CONVERSATION_NOT_FOUND';
        throw err;
      }
    } else {
      conversation = await conversationRepository.findByUserAndCharacter(userId, characterId);
      if (!conversation) {
        conversation = await conversationRepository.create({
          userId,
          characterId,
          title: `Chat with ${character.name}`,
        });

        if (character.greeting) {
          await messageRepository.create({
            conversationId: conversation.id,
            senderType: 'assistant',
            content: character.greeting,
            tokenCount: Math.ceil(character.greeting.length / 4),
          });
        }
      }
    }

    // 3. Persist incoming user message immediately
    const userTokenCount = Math.ceil(content.length / 4);
    const savedUserMessage = await messageRepository.create({
      conversationId: conversation.id,
      senderType: 'user',
      content,
      tokenCount: userTokenCount,
    });

    // 4. Retrieve contextual assets in parallel: memories, summary, recent messages, and public mind knowledge nodes
    const retrievalPromises = [
      memoryService.getMemoriesForPrompt({ userId, characterId, limit: 5 }),
      summaryService.getSummaryForPrompt(conversation.id),
      messageRepository.findRecentByConversationId(conversation.id, 10),
    ];

    if (isPublic) {
      retrievalPromises.push(mindRepository.findRelevantKnowledge(characterId, content, 5));
    }

    const [memories, summary, recentHistory, retrievedChunks = []] = await Promise.all(retrievalPromises);

    // 5. Sports Intelligence Resolution (if character is Sports Analyst)
    let sportsIntelPayload = null;
    let quantSignals = null;
    let bankrollContext = null;
    let tiltWarning = { triggered: false };

    const isSportsPersona = Boolean(
      character.is_sports_analyst ||
      (character.name && /betting|gambl|sports|analyst|tipster|pundit/i.test(character.name)) ||
      (character.personality && /betting|sports|odds|gambling/i.test(character.personality))
    );

    if (isSportsPersona) {
      bankrollContext = await sportsRepository.getBankrollSettings(userId);
      const streakTelemetry = await sportsRepository.getStreakTelemetry(userId);
      tiltWarning = detectTiltIntent(content, streakTelemetry);

      if (tiltWarning.triggered) {
        sportsRepository.updateStreakTelemetry(userId, {
          circuitBreakerActive: true,
          consecutiveLosses: tiltWarning.lossCount || 3,
        }).catch((e) => console.warn('[SPORTS STREAK UPDATE ERROR]', e.message));
      }

      let sportsIntent = detectSportsIntent(content, streakTelemetry);
      let suppressSportsCard = false;

      // Check if recent history already established a match so follow-up questions ("what about 2 corners?", "first 5 mins draw?") keep live match context
      const historyWithoutJustSaved = recentHistory.filter((m) => m.id !== savedUserMessage.id);
      let recentMatchFromHistory = null;
      for (let i = historyWithoutJustSaved.length - 1; i >= Math.max(0, historyWithoutJustSaved.length - 4); i--) {
        const extracted = extractMatchFromText(historyWithoutJustSaved[i].content);
        if (extracted && extracted.homeTeam && extracted.awayTeam) {
          recentMatchFromHistory = extracted;
          break;
        }
      }

      if ((!sportsIntent || sportsIntent.type === 'single_team') && recentMatchFromHistory) {
        sportsIntent = {
          type: 'match',
          homeTeam: recentMatchFromHistory.homeTeam,
          awayTeam: recentMatchFromHistory.awayTeam,
          isLookahead: recentMatchFromHistory.isLookahead,
          isOptionFollowUp: true,
        };
      }

      if (sportsIntent) {
        if (sportsIntent.type === 'match') {
          const sameAsRecentMatch =
            recentMatchFromHistory &&
            recentMatchFromHistory.homeTeam === sportsIntent.homeTeam &&
            recentMatchFromHistory.awayTeam === sportsIntent.awayTeam;

          if (sportsIntent.isOptionFollowUp || sameAsRecentMatch) {
            suppressSportsCard = true;
          }

          sportsIntelPayload = await sportsApiService.getFixtureIntel(sportsIntent);
          sportsIntelPayload = {
            ...sportsIntelPayload,
            isOptionFollowUp: Boolean(sportsIntent.isOptionFollowUp || sameAsRecentMatch),
          };
          quantSignals = quantService.analyzeMatch({
            homeTeam: sportsIntent.homeTeam,
            awayTeam: sportsIntent.awayTeam,
            matchIntel: sportsIntelPayload,
            bankrollSettings: bankrollContext,
            riskTier: character.risk_tier || 'balanced_quarter_kelly',
          });

          if (quantSignals.bestValue && !tiltWarning.triggered && !suppressSportsCard) {
            sportsRepository.recordBetRecommendation({
              userId,
              characterId: character.id,
              fixtureName: sportsIntelPayload.fixture,
              marketType: quantSignals.bestValue.marketType,
              recommendedSelection: quantSignals.bestValue.selection,
              modelWinProb: quantSignals.bestValue.prob,
              entryOdds: quantSignals.bestValue.odds,
              recommendedStakeUnits: quantSignals.bestValue.sizing.recommendedUnits,
              recommendedStakeAmount: quantSignals.bestValue.sizing.stakeAmount,
            }).catch((e) => console.warn('[BET LEDGER ERROR]', e.message));
          }
        } else if (sportsIntent.type === 'manager_query') {
          sportsIntelPayload = {
            type: 'manager_query',
            team: sportsIntent.team,
            manager: sportsIntent.manager,
          };
        } else if (sportsIntent.type === 'fixtures_query') {
          const upcoming = await sportsApiService.getUpcomingLeagueFixtures(sportsIntent.league);
          sportsIntelPayload = {
            type: 'fixtures_query',
            league: sportsIntent.league,
            fixtures: upcoming,
          };
        } else if (sportsIntent.type === 'single_team') {
          sportsIntelPayload = {
            type: 'single_team',
            team: sportsIntent.team,
            manager: sportsIntent.manager,
          };
        }
      }
    }

    // 6. Build enriched composite system prompt
    const systemPrompt = promptService.buildSystemPrompt({
      character,
      memories,
      summary,
      retrievedChunks,
      sportsIntel: sportsIntelPayload,
      quantSignals,
      bankrollContext,
      tiltWarning,
      conversationMode,
    });

    // 7. Format messages array for OpenAI
    // Exclude the message we just persisted from history to avoid duplicating it
    const historyWithoutCurrent = recentHistory.filter((m) => m.id !== savedUserMessage.id);
    const messagesPayload = [
      { role: 'system', content: systemPrompt },
      ...historyWithoutCurrent.map((msg) => ({
        role: msg.sender_type === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      { role: 'user', content },
    ];

    // 8. Dispatch real-time stream
    const stream = await openAiService.createChatStream({
      messages: messagesPayload,
      signal,
    });

    let fullAssistantResponse = '';

    for await (const chunk of stream) {
      if (signal?.aborted) {
        console.log('[ORCHESTRATOR] Stream aborted by client.');
        break;
      }
      fullAssistantResponse += chunk;
      onChunk(chunk);
    }

    // If client aborted and no content was generated, return cleanly
    if (signal?.aborted && !fullAssistantResponse) {
      console.log('[ORCHESTRATOR] Stream ended without content due to client abort.');
      return;
    }

    // 9. Persist assistant reply to database
    const assistantTokenCount = Math.ceil(fullAssistantResponse.length / 4);
    const savedAssistantMessage = await messageRepository.create({
      conversationId: conversation.id,
      senderType: 'assistant',
      content: fullAssistantResponse,
      tokenCount: assistantTokenCount,
    });

    // 10. Update conversation last activity
    await conversationRepository.updateLastMessageAt(conversation.id);

    if (isPublic) {
      mindRepository.incrementInteractions(characterId).catch((err) =>
        console.error('[ORCHESTRATOR] Error incrementing interactions:', err.message)
      );
    }

    // 11. Notify completion with optional sports intelligence metadata
    onDone({
      conversationId: conversation.id,
      character: {
        id: character.id,
        name: character.name,
        avatar_url: character.avatar_url,
        is_public: character.is_public,
        is_verified: character.is_verified,
        handle: character.handle,
        is_sports_analyst: character.is_sports_analyst,
        risk_tier: character.risk_tier,
      },
      userMessage: savedUserMessage,
      assistantMessage: savedAssistantMessage,
      groundedChunksCount: retrievedChunks.length,
      groundedSources: retrievedChunks.map((c) => ({
        id: c.id,
        title: c.title,
        topic: c.topic,
      })),
      sportsIntel: (isSportsPersona && ((sportsIntelPayload && !sportsIntelPayload.isOptionFollowUp) || tiltWarning.triggered))
        ? {
            type: sportsIntelPayload?.type || 'match',
            fixture: sportsIntelPayload?.fixture || null,
            homeManager: sportsIntelPayload?.homeManager || null,
            awayManager: sportsIntelPayload?.awayManager || null,
            manager: sportsIntelPayload?.manager || null,
            team: sportsIntelPayload?.team || null,
            fixtures: sportsIntelPayload?.fixtures || null,
            isLookahead: Boolean(sportsIntelPayload?.isLookahead),
            isLiveData: Boolean(sportsIntelPayload?.isLiveData),
            liveSourceLabel: sportsIntelPayload?.liveSourceLabel || null,
            commenceTime: sportsIntelPayload?.commenceTime || null,
            bookmakerSource: sportsIntelPayload?.bookmakerSource || null,
            homeFormSummary: sportsIntelPayload?.homeFormSummary || null,
            awayFormSummary: sportsIntelPayload?.awayFormSummary || null,
            probs: quantSignals?.probs || null,
            odds: sportsIntelPayload?.odds || null,
            bestValue: quantSignals?.bestValue || null,
            safeAccumulator: quantSignals?.safeAccumulator || null,
            regressionWarning: quantSignals?.regressionWarning || null,
            sizing: quantSignals?.bestValue?.sizing || null,
            tiltWarning,
            circuitBreakerActive: Boolean(tiltWarning.triggered),
          }
        : null,
    });

    // 11. Decoupled Asynchronous Background Tasks (Memory extraction & Rolling summary)
    // Run asynchronously without awaiting so the user's connection closes cleanly
    const backgroundTurns = [
      { sender_type: 'user', content },
      { sender_type: 'assistant', content: fullAssistantResponse },
    ];

    memoryService.extractAndSaveMemoriesAsync({
      userId,
      characterId,
      characterName: character.name,
      recentTurns: backgroundTurns,
      conversationId: conversation.id,
      conversationTimestamp: savedUserMessage?.created_at ? new Date(savedUserMessage.created_at) : new Date(),
    }).catch((err) => {
      console.error('[BACKGROUND MEMORY ERROR]', err.message);
    });

    summaryService.processRollingSummaryAsync({
      conversationId: conversation.id,
      characterName: character.name,
    }).catch((err) => {
      console.error('[BACKGROUND SUMMARY ERROR]', err.message);
    });
  }

  /**
   * Non-streaming turn (backwards compatible).
   */
  async processChatTurn({ userId, characterId, conversationId, content }) {
    let assistantMessage = null;
    let turnResult = null;

    await this.streamChatTurn({
      userId,
      characterId,
      conversationId,
      content,
      onChunk: () => {},
      onDone: (result) => {
        turnResult = result;
      },
    });

    return turnResult;
  }
}

export const aiOrchestrator = new AiOrchestrator();
export default aiOrchestrator;
