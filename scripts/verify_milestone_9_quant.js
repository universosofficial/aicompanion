import quantService from '../services/sports/quant.service.js';
import sportsApiService from '../services/sports/sports-api.service.js';
import { extractMatchFromText, detectTiltIntent } from '../services/sports/sports-detector.js';
import { buildSportsAnalystSystemPrompt } from '../services/ai/prompt.service.js';

console.log('====================================================');
console.log('   VERIFYING MILESTONE 9: QUANT SPORTS BETTING     ');
console.log('====================================================\n');

// 1. Math Verification: Poisson & xG adjustment
console.log('--- 1. POISSON & xG ADJUSTMENTS ---');
const p0 = quantService.poisson(0, 1.5);
const p1 = quantService.poisson(1, 1.5);
const p2 = quantService.poisson(2, 1.5);
console.log(`Poisson k=0 (lambda=1.5): ${p0.toFixed(4)}`);
console.log(`Poisson k=1 (lambda=1.5): ${p1.toFixed(4)}`);
console.log(`Poisson k=2 (lambda=1.5): ${p2.toFixed(4)}`);
if (Math.abs(p0 - 0.2231) > 0.01) throw new Error('Poisson calculation error');

const adjRest = quantService.adjustXG(1.8, { restDays: 2, isEuropeanTravel: false });
const adjEuro = quantService.adjustXG(1.8, { restDays: 2, isEuropeanTravel: true });
console.log(`Base xG 1.8 -> Rest < 3 days: ${adjRest} (Expected ~1.62)`);
console.log(`Base xG 1.8 -> Euro Travel & Rest < 3 days: ${adjEuro} (Expected ~1.43)`);
if (adjRest >= 1.8 || adjEuro >= adjRest) throw new Error('xG fatigue penalty failed');

// 2. Simulation Matrix
console.log('\n--- 2. MATCH MATRIX SIMULATION ---');
const sim = quantService.simulateMatchMatrix(1.7, 1.2);
console.log('Simulation Results:', sim);
const probSum = sim.homeProb + sim.drawProb + sim.awayProb;
console.log(`Total 1X2 Probability Sum: ${probSum}%`);
if (probSum < 98 || probSum > 102) throw new Error('Simulation probabilities do not sum near 100%');

// 3. Fractional Kelly Staking
console.log('\n--- 3. FRACTIONAL KELLY STAKING ---');
const kellyQuarter = quantService.calculateKellyStake({
  bankroll: 1000,
  modelProbPercent: 52.0,
  decimalOdds: 2.10,
  stakingModel: 'quarter_kelly',
  maxCapPercent: 2.5,
});
console.log('Quarter Kelly Sizing:', kellyQuarter);
if (!kellyQuarter.isPositiveEV) throw new Error('Expected +EV on 52% @ 2.10');
if (kellyQuarter.edgePercent <= 0) throw new Error('Edge percent should be positive');
console.log(`+EV Edge: +${kellyQuarter.edgePercent}% | Units: ${kellyQuarter.recommendedUnits}u | $: $${kellyQuarter.stakeAmount}`);

// 4. Negative Regression Check
console.log('\n--- 4. NEGATIVE REGRESSION TRAP DETECTION ---');
const regressionTrap = quantService.checkRegression(18, 12, 19, 14.5);
console.log('Regression signal:', regressionTrap);
if (!regressionTrap || !regressionTrap.includes('NEGATIVE REGRESSION TRAP')) {
  throw new Error('Regression trap was not flagged');
}

// 5. Team Normalization & Manager Intelligence
console.log('\n--- 5. CLUB NORMALIZATION & MANAGER VERIFICATION ---');
const liverpoolManager = sportsApiService.getManagerForTeam('Man City');
const bournemouthManager = sportsApiService.getManagerForTeam('Bournemouth');
const chelseaManager = sportsApiService.getManagerForTeam('Chelsea');
console.log(`Manchester City Active Coach: ${liverpoolManager}`);
console.log(`AFC Bournemouth Active Coach: ${bournemouthManager}`);
console.log(`Chelsea Active Coach: ${chelseaManager}`);
if (liverpoolManager !== 'Pep Guardiola') throw new Error('Incorrect Man City manager');
if (bournemouthManager !== 'Andoni Iraola') throw new Error('Incorrect Bournemouth manager');
if (chelseaManager !== 'Enzo Maresca') throw new Error('Incorrect Chelsea manager');

// 6. Matchday vs Lookahead Extraction
console.log('\n--- 6. FIXTURE & LOOKAHEAD PARSING ---');
const matchdayQuery = extractMatchFromText('Who should I back in Liverpool vs Manchester City?');
console.log('Parsed Matchday Query:', matchdayQuery);
if (matchdayQuery.homeTeam !== 'Liverpool' || matchdayQuery.awayTeam !== 'Manchester City' || matchdayQuery.isLookahead) {
  throw new Error('Failed to parse matchday query');
}

const lookaheadQuery = extractMatchFromText("What's your read on Arsenal vs Chelsea in 3 weeks?");
console.log('Parsed Lookahead Query:', lookaheadQuery);
if (lookaheadQuery.homeTeam !== 'Arsenal' || lookaheadQuery.awayTeam !== 'Chelsea' || !lookaheadQuery.isLookahead) {
  throw new Error('Failed to parse lookahead query');
}

// 7. Behavioral Tilt Detection
console.log('\n--- 7. BEHAVIORAL TILT INTERCEPTION ---');
const tiltTest = detectTiltIntent('I lost my last 3 bets, give me a lock to win it back.', { consecutive_losses: 0 });
console.log('Tilt Result:', tiltTest);
if (!tiltTest.triggered) throw new Error('Tilt intent failed to trigger');

// 8. 30-Second Glance Format Prompt Assembly
console.log('\n--- 8. 30-SECOND GLANCE PROMPT FORMAT ---');
const mockIntel = await sportsApiService.getFixtureIntel(matchdayQuery);
const mockQuant = quantService.analyzeMatch({
  homeTeam: matchdayQuery.homeTeam,
  awayTeam: matchdayQuery.awayTeam,
  matchIntel: mockIntel,
  bankrollSettings: { total_bankroll: 1000, staking_model: 'quarter_kelly' },
});

const generatedPrompt = buildSportsAnalystSystemPrompt(
  { name: 'Apex Quant', risk_tier: 'balanced_quarter_kelly' },
  mockIntel,
  mockQuant,
  { currency: '$', total: 1000, stakingModel: 'quarter_kelly' },
  { triggered: false }
);

console.log('Prompt Generated Preview (first 400 chars):');
console.log(generatedPrompt.substring(0, 400) + '...\n');

if (!generatedPrompt.includes('THE SIMPLE READ') ||
    !generatedPrompt.includes('SMART VALUE BET') ||
    !generatedPrompt.includes('SAFE / ACCUMULATOR PICK') ||
    !generatedPrompt.includes('DON\'T GET TRICKED BY')) {
  throw new Error('Prompt does not enforce 4-part 30-second glance structure');
}

console.log('====================================================');
console.log('   ALL MILESTONE 9 QUANT TESTS PASSED CLEANLY!     ');
console.log('====================================================');
process.exit(0);
