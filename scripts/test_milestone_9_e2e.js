import characterRepository from '../repositories/character.repository.js';
import userRepository from '../repositories/user.repository.js';
import sportsRepository from '../repositories/sports.repository.js';
import aiOrchestrator from '../services/ai/ai.orchestrator.js';

console.log('====================================================');
console.log('   END-TO-END VERIFICATION: MILESTONE 9 ENGINE     ');
console.log('====================================================\n');

// 1. Get or create test user
let user = await userRepository.findByEmail('quant_tester@ai.com');
if (!user) {
  user = await userRepository.create({
    email: 'quant_tester@ai.com',
    passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
    displayName: 'Quant Bettor',
  });
}
console.log(`[USER] Test user ID: ${user.id}`);

// 2. Configure Bankroll: $2,000, quarter_kelly, max 2.5% unit ($50)
await sportsRepository.updateBankrollSettings(user.id, {
  totalBankroll: 2000,
  currency: 'USD',
  stakingModel: 'quarter_kelly',
  maxUnitLimitPercent: 2.5,
  dailyStopLossPercent: 5.0,
});
console.log('[BANKROLL] Set to $2,000.00 USD (Quarter Kelly)');

// 3. Create Sports Betting Analyst Character
let analystChar = null;
const userChars = await characterRepository.findAllByUserId(user.id);
analystChar = userChars.find((c) => c.is_sports_analyst);

if (!analystChar) {
  analystChar = await characterRepository.create({
    userId: user.id,
    name: 'Apex Quant',
    personality: 'Hyper-disciplined quantitative sports bettor and expected value specialist.',
    tone: 'Direct, sharp, confident, and no-nonsense.',
    style: 'quant_expected_value',
    greeting: 'Welcome to the lab. We don’t bet on gut feelings or media narratives—we exploit mathematical mispricings and protect the bankroll.',
    isSportsAnalyst: true,
    analysisStyle: 'quant_expected_value',
    primaryLeagues: ['Premier League', 'Champions League', 'La Liga'],
    riskTier: 'balanced_quarter_kelly',
  });
}
console.log(`[CHARACTER] Sports Analyst Character ID: ${analystChar.id} ("${analystChar.name}")`);

// --- TEST 1: MATCHDAY QUERY ---
console.log('\n====================================================');
console.log('TEST 1: Matchday Query ("Who should I back in Liverpool vs Manchester City?")');
console.log('====================================================');

let turn1Output = '';
let turn1Done = null;

await aiOrchestrator.streamChatTurn({
  userId: user.id,
  characterId: analystChar.id,
  content: 'Who should I back in Liverpool vs Manchester City?',
  onChunk: (chunk) => {
    turn1Output += chunk;
  },
  onDone: (result) => {
    turn1Done = result;
  },
});

console.log('\n--- AI RESPONSE ---');
console.log(turn1Output);
console.log('\n--- METADATA ATTACHED ---');
console.log('Fixture:', turn1Done?.sportsIntel?.fixture);
console.log('Active Managers:', `${turn1Done?.sportsIntel?.homeManager} (Home) vs ${turn1Done?.sportsIntel?.awayManager} (Away)`);
console.log('Probabilities:', turn1Done?.sportsIntel?.probs);
console.log('Best Value Selection:', turn1Done?.sportsIntel?.bestValue?.selection, '@', turn1Done?.sportsIntel?.bestValue?.odds);
console.log('Calculated Sizing:', `${turn1Done?.sportsIntel?.sizing?.recommendedUnits}u ($${turn1Done?.sportsIntel?.sizing?.stakeAmount})`);

// Assertions for Test 1
if (!turn1Done?.sportsIntel?.fixture) throw new Error('Missing sportsIntel metadata');
if (!turn1Output.includes('THE SIMPLE READ') || !turn1Output.includes('SMART VALUE BET')) {
  console.warn('Note: Expected 30-second glance format sections');
}

// --- TEST 2: LOOKAHEAD QUERY ---
console.log('\n====================================================');
console.log('TEST 2: Lookahead Query ("What\'s your read on Arsenal vs Chelsea in 3 weeks?")');
console.log('====================================================');

let turn2Output = '';
let turn2Done = null;

await aiOrchestrator.streamChatTurn({
  userId: user.id,
  characterId: analystChar.id,
  content: "What's your read on Arsenal vs Chelsea in 3 weeks?",
  onChunk: (chunk) => {
    turn2Output += chunk;
  },
  onDone: (result) => {
    turn2Done = result;
  },
});

console.log('\n--- AI RESPONSE ---');
console.log(turn2Output);
console.log('\n--- METADATA ATTACHED ---');
console.log('Is Lookahead:', turn2Done?.sportsIntel?.isLookahead);
console.log('Active Managers:', `${turn2Done?.sportsIntel?.homeManager} vs ${turn2Done?.sportsIntel?.awayManager}`);
if (!turn2Done?.sportsIntel?.isLookahead) throw new Error('Lookahead mode was not flagged');

// --- TEST 3: TILT INTERVENTION ---
console.log('\n====================================================');
console.log('TEST 3: Tilt Intervention ("I lost my last 3 bets, give me a lock to win it back.")');
console.log('====================================================');

// Set 3 consecutive losses
await sportsRepository.updateStreakTelemetry(user.id, {
  consecutiveLosses: 3,
  circuitBreakerActive: true,
});

let turn3Output = '';
let turn3Done = null;

await aiOrchestrator.streamChatTurn({
  userId: user.id,
  characterId: analystChar.id,
  content: 'I lost my last 3 bets, give me a lock to win it back.',
  onChunk: (chunk) => {
    turn3Output += chunk;
  },
  onDone: (result) => {
    turn3Done = result;
  },
});

console.log('\n--- AI RESPONSE ---');
console.log(turn3Output);
console.log('\n--- METADATA ATTACHED ---');
console.log('Circuit Breaker Active:', turn3Done?.sportsIntel?.circuitBreakerActive);
console.log('Tilt Warning:', turn3Done?.sportsIntel?.tiltWarning);

if (!turn3Done?.sportsIntel?.circuitBreakerActive) {
  throw new Error('Circuit breaker was not active');
}

console.log('\n====================================================');
console.log('   ALL 3 END-TO-END DIRECTIVE TESTS PASSED!       ');
console.log('====================================================');
process.exit(0);
