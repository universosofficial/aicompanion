import sportsApiService from './sports-api.service.js';

/**
 * List of known soccer clubs for entity extraction from conversational prompts.
 */
const KNOWN_CLUBS = [
  'Liverpool', 'Manchester City', 'Arsenal', 'Chelsea', 'Tottenham Hotspur', 'Spurs',
  'Manchester United', 'Aston Villa', 'Newcastle United', 'Brighton & Hove Albion', 'Brighton',
  'AFC Bournemouth', 'Bournemouth', 'Wolverhampton Wanderers', 'Wolves', 'West Ham United',
  'West Ham', 'Nottingham Forest', 'Forest', 'Brentford', 'Fulham', 'Everton',
  'Crystal Palace', 'Real Madrid', 'Barcelona', 'Barca', 'Atletico Madrid', 'Bayern Munich',
  'Bayer Leverkusen', 'Borussia Dortmund', 'Dortmund', 'Paris Saint-Germain', 'PSG',
  'Inter Milan', 'Juventus', 'AC Milan',
];

/**
 * Parse team names and situational flags from user text.
 */
export function extractMatchFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const lower = text.toLowerCase();

  // 1. Detect lookahead intent (> 5 days out)
  const isLookahead =
    lower.includes('in 2 weeks') ||
    lower.includes('in 3 weeks') ||
    lower.includes('in 4 weeks') ||
    lower.includes('in a month') ||
    lower.includes('lookahead') ||
    lower.includes('weeks away') ||
    lower.includes('next month') ||
    /\bin \d+ days\b/.test(lower);

  // 1.5 Detect if this turn is grilling a specific option or asking a follow-up micro-market question
  const isOptionFollowUp =
    /^(?:let(?:'s|s)?\s+grill|for\s+[^,]+,\s*(?:grill|what\s+could)|what\s+about|and\s+what\s+about|how\s+about|do\s+you\s+think|is\s+it\s+safe|what\s+could\s+go\s+wrong)/i.test(lower.trim()) ||
    /\b(?:corner|corners|card|cards|first\s+\d+\s+min|half\s*time|ht\/ft|shot|shots|foul|fouls|penalty|btts|both\s+teams\s+to\s+score|double\s+chance|draw\s+no\s+bet|over\s+\d|under\s+\d)\b/i.test(lower);

  // 2. Scan known clubs ordered by position of appearance FIRST (prevents capturing conversational prefixes like "What is your view on Chelsea")
  const found = [];
  for (const club of KNOWN_CLUBS) {
    const escaped = club.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    const match = regex.exec(text);
    if (match) {
      const norm = sportsApiService.normalizeTeamName(club);
      if (!found.some((f) => f.name === norm)) {
        found.push({ name: norm, index: match.index });
      }
    }
  }

  found.sort((a, b) => a.index - b.index);

  if (found.length >= 2) {
    return {
      homeTeam: found[0].name,
      awayTeam: found[1].name,
      isLookahead,
      isOptionFollowUp,
    };
  }

  // 3. Fallback: explicit "Team A vs Team B" pattern in the first sentence/clause for unlisted clubs
  const firstClause = text.split(/[\.\!\?\n—]/)[0] || text;
  const vsPattern = /([A-Za-z0-9&\s'-]+?)\s+(?:vs\.?|v\.?|versus|against)\s+([A-Za-z0-9&\s'-]+)/i;
  const vsMatch = firstClause.match(vsPattern);

  if (vsMatch) {
    const cleanPrefix = (s) => {
      let cleaned = s
        .replace(
          /^.*?\b(?:on|in|for|about|between|of|at|regarding|forecast|grill|analyze|look at|break down|preview)\s+/i,
          ''
        )
        .replace(
          /^(?:let(?:'s|s)?\s+(?:forecast|grill|analyze|look at|break down|put heads together on)|who should i back in|who wins in|what(?:'s|s| is)?\s+(?:your\s+)?(?:view|read|take|thought|opinion)\s*(?:on)?|thoughts on|preview|forecast)\s+/gi,
          ''
        )
        .trim();
      return cleaned;
    };
    const cleanSuffix = (s) =>
      s
        .replace(
          /\s+(?:and\s+put\s+heads\s+together.*|and\s+tell\s+me.*|and\s+grill.*|grill\s+.*|what\s+could.*|which\s+one.*|in\s+\d+\s+(?:weeks|days).*|next\s+month.*|this\s+weekend.*|today.*|tomorrow.*)$/gi,
          ''
        )
        .replace(/[,:;].*$/, '')
        .trim();

    const rawHome = cleanPrefix(vsMatch[1]);
    const rawAway = cleanSuffix(vsMatch[2]);
    if (rawHome && rawAway && rawHome.length <= 28 && rawAway.length <= 28) {
      const homeTeam = sportsApiService.normalizeTeamName(rawHome);
      const awayTeam = sportsApiService.normalizeTeamName(rawAway);
      if (homeTeam && awayTeam && homeTeam !== 'Unknown Team' && awayTeam !== 'Unknown Team') {
        return { homeTeam, awayTeam, isLookahead, isOptionFollowUp };
      }
    }
  }

  return null;
}

/**
 * Detect revenge betting / tilt patterns in user text.
 */
export function detectTiltIntent(text, telemetry = {}) {
  if (!text) return { triggered: Boolean(telemetry.circuit_breaker_active), reason: telemetry.circuit_breaker_active ? 'Circuit breaker active' : '' };

  const lower = text.toLowerCase();

  // Match mentions of loss streaks
  const lossStreakPattern = /lost (?:my )?(?:last )?(\d+) bets|down (\d+) in a row|(\d+) losses in a row|lost (\d+) straight/i;
  const lossMatch = lower.match(lossStreakPattern);

  const revengeKeywords = [
    'win it back',
    'win back my losses',
    'chase my losses',
    'lock to win it back',
    'guaranteed lock',
    'double down',
    'revenge bet',
    'go all in',
    'all in on',
  ];

  const hasRevengeKeyword = revengeKeywords.some((kw) => lower.includes(kw));

  if (lossMatch) {
    const streakCount = parseInt(lossMatch[1] || lossMatch[2] || lossMatch[3] || lossMatch[4], 10);
    if (streakCount >= 3) {
      return {
        triggered: true,
        reason: `DETECTED ${streakCount}-LOSS STREAK & REVENGE BETTING INTENT: Tilt intervention active. Refusing high-risk selections to preserve bankroll.`,
        lossCount: streakCount,
      };
    }
  }

  if (hasRevengeKeyword || telemetry.consecutive_losses >= 3 || telemetry.circuit_breaker_active) {
    return {
      triggered: true,
      reason: 'BEHAVIORAL TILT DETECTED: Chasing losses triggers mandatory capital preservation. High-risk picks suspended.',
      lossCount: telemetry.consecutive_losses || 3,
    };
  }

  return { triggered: false, reason: '' };
}

/**
 * High-level sports intent classifier covering:
 * - Tilt / revenge betting
 * - Manager queries ("who is the manager of liverpool")
 * - Fixtures queries ("fixtures in the premier league this weekend")
 * - 1X2 Match pairs ("Liverpool vs Man City")
 * - Single team inquiries
 */
export function detectSportsIntent(text, telemetry = {}) {
  if (!text || typeof text !== 'string') return null;

  // 1. Tilt check
  const tilt = detectTiltIntent(text, telemetry);
  if (tilt.triggered) {
    return { type: 'tilt', ...tilt };
  }

  const lower = text.toLowerCase().trim();

  // 2. Manager query check ("who is the manager of liverpool", "who coaches man city", etc.)
  const managerRegex = /(?:who(?:'s| is)? (?:the )?(?:current )?(?:manager|head coach|coach|boss) of|who (?:manages|coaches))\s+([A-Za-z\s]+)/i;
  const managerMatch = text.match(managerRegex);
  if (managerMatch) {
    const rawTeam = managerMatch[1].replace(/\?|\.|\!/g, '').trim();
    const normalized = sportsApiService.normalizeTeamName(rawTeam);
    const manager = sportsApiService.getManagerForTeam(normalized);
    return {
      type: 'manager_query',
      team: normalized,
      manager,
      rawTeam,
    };
  }

  const managerRegex2 = /([A-Za-z\s]+?)\s+(?:manager|head coach|coach)\b/i;
  if (/who|what|tell me/i.test(lower) && managerRegex2.test(text)) {
    const match2 = text.match(managerRegex2);
    if (match2) {
      const candidate = match2[1].replace(/who is|who's|the/gi, '').trim();
      const norm = sportsApiService.normalizeTeamName(candidate);
      if (norm !== 'Unknown Team') {
        const manager = sportsApiService.getManagerForTeam(norm);
        return {
          type: 'manager_query',
          team: norm,
          manager,
          rawTeam: candidate,
        };
      }
    }
  }

  // 3. Match pairing check (Liverpool vs Man City, etc.)
  const match = extractMatchFromText(text);
  if (match) {
    return {
      type: 'match',
      ...match,
    };
  }

  // 4. Fixtures / Schedule query check ("fixtures in the premier league this weekend", "weekend games", "epl matches")
  const fixturesKeywords = ['fixtures', 'matches', 'games', 'schedule', 'slate'];
  const hasFixturesKeyword = fixturesKeywords.some((kw) => lower.includes(kw));
  const hasTemporalOrLeague = /premier league|epl|la liga|champions league|serie a|bundesliga|weekend|today|tomorrow|upcoming|this week/i.test(lower);

  if (hasFixturesKeyword && hasTemporalOrLeague) {
    let league = 'Premier League';
    if (/la liga/i.test(lower)) league = 'La Liga';
    else if (/champions league/i.test(lower)) league = 'Champions League';
    else if (/serie a/i.test(lower)) league = 'Serie A';
    else if (/bundesliga/i.test(lower)) league = 'Bundesliga';

    return {
      type: 'fixtures_query',
      league,
      timeframe: /weekend/i.test(lower) ? 'weekend' : 'upcoming',
    };
  }

  // 5. Single club mention
  for (const club of KNOWN_CLUBS) {
    if (lower.includes(club.toLowerCase())) {
      const norm = sportsApiService.normalizeTeamName(club);
      return {
        type: 'single_team',
        team: norm,
        manager: sportsApiService.getManagerForTeam(norm),
      };
    }
  }

  return null;
}

export default {
  extractMatchFromText,
  detectTiltIntent,
  detectSportsIntent,
};
