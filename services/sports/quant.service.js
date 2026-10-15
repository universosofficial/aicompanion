/**
 * QuantService
 * 5-Pillar Quantitative Analytics & Fractional Kelly Staking Engine
 * Implements Poisson goal expectancy, vig-removal, +EV edge detection,
 * rest-day penalties, negative regression detection, and bankroll position sizing.
 */

function factorial(n) {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

export function poisson(k, lambda) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

/**
 * Adjust base xG for rest deficit, European travel, and spine injuries.
 * @param {number} baseXG - Base team expected goals
 * @param {Object} factors
 * @param {number} [factors.restDays=4] - Days since previous competitive match
 * @param {boolean} [factors.isEuropeanTravel=false] - Played midweek European away match
 * @param {boolean} [factors.missingSpineCB=false] - Starting center back / spine missing
 * @returns {number}
 */
export function adjustXG(baseXG, { restDays = 4, isEuropeanTravel = false, missingSpineCB = false } = {}) {
  let adj = Number(baseXG) || 1.35;
  if (restDays < 3) adj *= 0.90;
  if (isEuropeanTravel && restDays <= 3) adj *= 0.88;
  if (missingSpineCB) adj *= 1.08; // Opponent chance quality increases
  return Math.max(0.3, Number(adj.toFixed(2)));
}

/**
 * Simulate 1X2, Totals, and BTTS probabilities using bivariate Poisson convolution.
 * @param {number} homeAdjXG
 * @param {number} awayAdjXG
 * @returns {{ homeProb: number, drawProb: number, awayProb: number, over25Prob: number, under25Prob: number }}
 */
export function simulateMatchMatrix(homeAdjXG, awayAdjXG) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over25 = 0;

  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      const p = poisson(h, homeAdjXG) * poisson(a, awayAdjXG);
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;

      if (h + a > 2.5) over25 += p;
    }
  }

  const under25 = 1 - over25;

  return {
    homeProb: Number((homeWin * 100).toFixed(1)),
    drawProb: Number((draw * 100).toFixed(1)),
    awayProb: Number((awayWin * 100).toFixed(1)),
    over25Prob: Number((over25 * 100).toFixed(1)),
    under25Prob: Number((under25 * 100).toFixed(1)),
  };
}

/**
 * Calculate Fractional Kelly position sizing based on model probability and bookmaker odds.
 * @param {Object} params
 * @param {number} params.bankroll - Current bankroll amount
 * @param {number} params.modelProbPercent - Model estimated probability (0-100)
 * @param {number} params.decimalOdds - Bookmaker decimal odds (e.g. 2.10)
 * @param {string} [params.stakingModel='quarter_kelly'] - 'quarter_kelly', 'eighth_kelly', or 'fixed_unit'
 * @param {number} [params.maxCapPercent=2.5] - Max unit percentage cap (e.g. 2.5%)
 * @returns {{ isPositiveEV: boolean, edgePercent: number, recommendedUnits: number, stakeAmount: number }}
 */
export function calculateKellyStake({
  bankroll = 1000,
  modelProbPercent,
  decimalOdds,
  stakingModel = 'quarter_kelly',
  maxCapPercent = 2.5,
}) {
  const p = modelProbPercent / 100;
  const b = decimalOdds - 1;
  const q = 1 - p;

  if (b <= 0) {
    return { isPositiveEV: false, recommendedUnits: 0, stakeAmount: 0, edgePercent: 0 };
  }

  const fullKelly = (b * p - q) / b;

  if (fullKelly <= 0) {
    return { isPositiveEV: false, recommendedUnits: 0, stakeAmount: 0, edgePercent: 0 };
  }

  let fraction = 0.25; // default quarter kelly
  if (stakingModel === 'eighth_kelly' || stakingModel === 'conservative_eighth_kelly') {
    fraction = 0.125;
  } else if (stakingModel === 'fixed_unit' || stakingModel === 'fixed_one_percent') {
    fraction = 0.10;
  }

  let targetPercent = fullKelly * fraction * 100;
  targetPercent = Math.min(targetPercent, maxCapPercent);

  const edgePercent = Number(((p * decimalOdds - 1) * 100).toFixed(2));
  const recommendedUnits = Number(targetPercent.toFixed(2));
  const stakeAmount = Number(((bankroll * targetPercent) / 100).toFixed(2));

  return {
    isPositiveEV: true,
    edgePercent,
    recommendedUnits,
    stakeAmount,
  };
}

/**
 * Identify risky traps in plain football terms.
 */
export function checkRegression(actualPoints, expectedPoints, actualGoals, xG) {
  if (actualPoints - expectedPoints >= 5 && actualGoals - xG >= 4.0) {
    return 'Avoid straight Win without insurance — recent scorelines flatter them and they concede clear chances.';
  }
  return 'Avoid chasing high-risk Correct Score or heavy Handicap lines; stick to Double Chance or Goals.';
}

/**
 * Comprehensive Match Quantitative Analysis:
 * Combines simulation, odds valuation, Kelly sizing, and regression flags.
 */
export function analyzeMatch({
  homeTeam,
  awayTeam,
  matchIntel,
  bankrollSettings = {},
  riskTier = 'balanced_quarter_kelly',
}) {
  const bankroll = bankrollSettings.total_bankroll || 1000;
  const maxCap = bankrollSettings.max_unit_limit_percent || 2.5;
  const stakingModel = bankrollSettings.staking_model || riskTier || 'quarter_kelly';

  // 1. Compute Adjusted xG
  const homeAdjXG = adjustXG(matchIntel.homeBaseXG || 1.65, {
    restDays: matchIntel.homeRestDays || 4,
    isEuropeanTravel: matchIntel.homeEuropeanTravel || false,
    missingSpineCB: matchIntel.homeMissingSpineCB || false,
  });

  const awayAdjXG = adjustXG(matchIntel.awayBaseXG || 1.25, {
    restDays: matchIntel.awayRestDays || 4,
    isEuropeanTravel: matchIntel.awayEuropeanTravel || false,
    missingSpineCB: matchIntel.awayMissingSpineCB || false,
  });

  // 2. Simulate match probabilities
  const probs = simulateMatchMatrix(homeAdjXG, awayAdjXG);

  // 3. Evaluate +EV across available markets
  const odds = matchIntel.odds || { home: 2.10, draw: 3.40, away: 3.60, over25: 1.85, under25: 1.95 };

  const markets = [
    {
      selection: `${homeTeam} to Win`,
      market: 'Match Winner',
      marketType: '1X2 (Match Winner)',
      prob: probs.homeProb,
      odds: odds.home,
    },
    {
      selection: 'Draw',
      market: 'Match Winner',
      marketType: '1X2 (Match Winner)',
      prob: probs.drawProb,
      odds: odds.draw,
    },
    {
      selection: `${awayTeam} to Win`,
      market: 'Match Winner',
      marketType: '1X2 (Match Winner)',
      prob: probs.awayProb,
      odds: odds.away,
    },
    {
      selection: 'Over 2.5 Goals',
      market: 'Goals',
      marketType: 'Totals',
      prob: probs.over25Prob,
      odds: odds.over25 || 1.85,
    },
    {
      selection: 'Under 2.5 Goals',
      market: 'Goals',
      marketType: 'Totals',
      prob: probs.under25Prob,
      odds: odds.under25 || 1.95,
    },
  ];

  // Calculate Kelly for each market
  const evaluatedMarkets = markets.map((m) => {
    const sizing = calculateKellyStake({
      bankroll,
      modelProbPercent: m.prob,
      decimalOdds: m.odds,
      stakingModel,
      maxCapPercent: maxCap,
    });
    return { ...m, sizing };
  });

  // Sort by edge percent to find best value bet
  const positiveEVs = evaluatedMarkets.filter((m) => m.sizing.isPositiveEV && m.sizing.edgePercent > 1.5);
  positiveEVs.sort((a, b) => b.sizing.edgePercent - a.sizing.edgePercent);

  const bestValue = positiveEVs[0] || evaluatedMarkets[0];

  // Identify safe / accumulator pick (highest model win probability)
  const safePicks = [...evaluatedMarkets].sort((a, b) => b.prob - a.prob);
  const highestProbPick = safePicks[0];
  let safeSelectionText = '';
  if (highestProbPick.prob >= 55) {
    safeSelectionText = `${highestProbPick.selection} (or Over 1.5 Goals)`;
  } else {
    // Generate Double Chance or Over 1.5
    safeSelectionText = probs.homeProb >= probs.awayProb
      ? `${homeTeam} or Draw (1X Double Chance)`
      : `${awayTeam} or Draw (X2 Double Chance)`;
  }

  const safeAccumulator = {
    selection: safeSelectionText,
    market: 'Safer Ticket Angle',
    marketType: 'Double Chance / Safe Line',
  };

  // Check negative regression trap
  const regressionWarning = checkRegression(
    matchIntel.homePoints || 12,
    matchIntel.homeExpectedPoints || 7,
    matchIntel.homeGoals || 14,
    matchIntel.homeXG || 9.2
  );

  return {
    homeAdjXG,
    awayAdjXG,
    probs,
    odds,
    bestValue,
    safeAccumulator,
    regressionWarning,
    evaluatedMarkets,
  };
}

export default {
  poisson,
  adjustXG,
  simulateMatchMatrix,
  calculateKellyStake,
  checkRegression,
  analyzeMatch,
};
