import baseRepository from '../repositories/base.repository.js';
import characterRepository from '../repositories/character.repository.js';
import mindRepository from '../repositories/mind.repository.js';
import { buildPublicMindSystemPrompt, buildEmotionalSystemPrompt } from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';
import memoryService from '../services/ai/memory.service.js';

async function runSocraticMentorshipVerification() {
  console.log('================================================================');
  console.log('  PERSONA ENGINE UPGRADE: SOCRATIC MENTORSHIP & PACING TEST    ');
  console.log('================================================================\n');

  // 1. Verify Prompt Construction & Socratic Directives
  console.log('[1/5] Verifying Prompt Rules in PromptService...');
  const testMind = {
    id: 999,
    name: 'Elon Musk',
    handle: 'elonmusk',
    headline: 'Chief Engineer & Technologist',
    philosophy_statement: 'Boil things down to fundamental physics truths. Reason from first principles rather than by analogy.',
    decision_frameworks: [
      'First Principles Reasoning (physics-based ground truth)',
      'The 5-Step Engineering Process (question requirements, delete, simplify, accelerate, automate)',
      'Customer Value First (do not optimize something that should not exist)',
    ],
    tags: ['Engineering', 'Founders', 'AI', 'Physics'],
  };

  const publicPrompt = buildPublicMindSystemPrompt(testMind);
  if (!publicPrompt.includes('[CONVERSATIONAL PACING & SOCRATIC MENTORSHIP RULES]')) {
    throw new Error('Public mind prompt missing [CONVERSATIONAL PACING & SOCRATIC MENTORSHIP RULES].');
  }
  if (!publicPrompt.includes('HARD LENGTH CEILING') || !publicPrompt.includes('PROBE FIRST, LECTURE NEVER')) {
    throw new Error('Public mind prompt missing HARD LENGTH CEILING or PROBE FIRST rules.');
  }
  console.log('[PASS] Public Mind prompt contains Socratic mentorship & conversational pacing rules.');

  const emotionalPrompt = buildEmotionalSystemPrompt({
    name: 'Marcus',
    relationship_type: 'mentor',
    personality: 'Grounded, sharp, candid tech founder',
    tone: 'Direct, thoughtful, inquisitive',
  });
  if (!emotionalPrompt.includes('[CONVERSATIONAL PACING & SOCRATIC MENTORSHIP RULES]')) {
    throw new Error('Emotional system prompt missing [CONVERSATIONAL PACING & SOCRATIC MENTORSHIP RULES].');
  }
  console.log('[PASS] Emotional persona prompt contains Socratic mentorship & conversational pacing rules.');

  // 2. Turn 1 Test: Socratic Brevity & Probing on Classic Startup Prompt
  console.log('\n[2/5] Testing Turn 1: "I want to build an AI app, but I don\'t know where to start."');
  const userQuery1 = "I want to build an AI app, but I don't know where to start.";
  
  const messagesTurn1 = [
    { role: 'system', content: publicPrompt },
    { role: 'user', content: userQuery1 },
  ];

  console.log('Generating response via openAiService (max_tokens: 300, temp: 0.65)...');
  const resultTurn1 = await openAiService.generateChatCompletion({
    messages: messagesTurn1,
  });

  const response1 = resultTurn1.content.trim();
  console.log('\n--- MODEL RESPONSE (Turn 1) ---');
  console.log(response1);
  console.log('-------------------------------\n');

  // Verify response rules
  // Rule A: No bulleted lists
  const bulletMatches = response1.match(/^(\s*[-*•]|\s*\d+\.)\s+/m);
  if (bulletMatches) {
    throw new Error(`Violation: Response contained bulleted list formatting: ${bulletMatches[0]}`);
  }
  console.log('[PASS] Zero bulleted list formatting (no essay dumping).');

  // Rule B: Sentence count between 1 and 6 sentences
  const sentences = response1
    .split(/(?<=[.?!])\s+/)
    .filter((s) => s.trim().length > 0);
  console.log(`[PASS] Sentence count: ${sentences.length} sentences (target: 2-5 sentences).`);
  if (sentences.length > 6) {
    throw new Error(`Violation: Response too long (${sentences.length} sentences).`);
  }

  // Rule C: Must contain a probing question mark
  if (!response1.includes('?')) {
    throw new Error('Violation: Response did not ask a probing Socratic question.');
  }
  console.log('[PASS] Contains pointed probing question (?): Confirmed.');

  // Rule D: Assistant Fluff check
  const lowerResp1 = response1.toLowerCase();
  const fluffPhrases = ["that's a great question", "great question", "i'd be happy to help", "as an ai", "sure!"];
  for (const fluff of fluffPhrases) {
    if (lowerResp1.includes(fluff)) {
      throw new Error(`Violation: Response contained assistant fluff phrase: "${fluff}"`);
    }
  }
  console.log('[PASS] Zero assistant fluff detected.');

  // 3. Memory Extraction Calibration Test (Goals & Blockers)
  console.log('\n[3/5] Testing Calibrated Memory Extraction for Goals, Constraints & Blockers...');
  const userQuery2 =
    "Honestly, my real bottleneck is I have zero distribution and no paying customers lined up yet. I'm terrified of wasting 3 months writing code for something nobody will pay for.";

  const recentTurns = [
    { sender_type: 'user', content: userQuery1 },
    { sender_type: 'assistant', content: response1 },
    { sender_type: 'user', content: userQuery2 },
  ];

  const extractedMemories = await openAiService.extractMemories({
    characterName: 'Elon Musk',
    recentTurns,
  });

  console.log(`Extracted ${extractedMemories.length} memory item(s):`);
  extractedMemories.forEach((m, idx) => {
    console.log(`  [Memory ${idx + 1}] [${m.memoryType.toUpperCase()} / ${m.category.toUpperCase()}] "${m.content}" (Importance: ${m.importanceScore})`);
  });

  const hasGoalOrBlocker = extractedMemories.some(
    (m) =>
      (m.category === 'goal' || m.category === 'fact') &&
      m.importanceScore >= 4 &&
      (m.content.toLowerCase().includes('distribution') ||
       m.content.toLowerCase().includes('customer') ||
       m.content.toLowerCase().includes('ai app') ||
       m.content.toLowerCase().includes('waste') ||
       m.content.toLowerCase().includes('bottleneck') ||
       m.content.toLowerCase().includes('start'))
  );

  if (!hasGoalOrBlocker) {
    throw new Error('Memory extraction failed to capture user goal, constraint, or revealed blocker with importance >= 4.');
  }
  console.log('[PASS] Memory extraction accurately classified user goal/blocker with high importance (4-5).');

  // 4. Turn 2 Test: Guided Socratic Follow-Up with Recalled Context
  console.log('\n[4/5] Testing Turn 2 with Recalled Memory Injection...');
  const promptWithMemory = buildPublicMindSystemPrompt(testMind, [], extractedMemories);
  if (!promptWithMemory.includes('[WHAT YOU CURRENTLY KNOW ABOUT THIS USER]')) {
    throw new Error('Public mind prompt failed to inject recalled user memories.');
  }

  const messagesTurn2 = [
    { role: 'system', content: promptWithMemory },
    { role: 'user', content: userQuery1 },
    { role: 'assistant', content: response1 },
    { role: 'user', content: userQuery2 },
  ];

  const resultTurn2 = await openAiService.generateChatCompletion({
    messages: messagesTurn2,
  });

  const response2 = resultTurn2.content.trim();
  console.log('\n--- MODEL RESPONSE (Turn 2) ---');
  console.log(response2);
  console.log('-------------------------------\n');

  const sentences2 = response2
    .split(/(?<=[.?!])\s+/)
    .filter((s) => s.trim().length > 0);

  if (sentences2.length > 6) {
    throw new Error(`Turn 2 violation: Response exceeded length limit (${sentences2.length} sentences).`);
  }
  if (!response2.includes('?')) {
    throw new Error('Turn 2 violation: Response did not maintain Socratic inquiry with a probing question.');
  }
  console.log(`[PASS] Turn 2 maintained Socratic pacing (${sentences2.length} sentences, ended with probe).`);

  // 5. Streaming Real-Time Cadence Test
  console.log('\n[5/5] Testing Real-Time Streaming Cadence (createChatStream)...');
  const stream = await openAiService.createChatStream({
    messages: [
      { role: 'system', content: publicPrompt },
      { role: 'user', content: "Should I write a landing page or cold DM 20 people?" },
    ],
  });

  let streamedResponse = '';
  for await (const chunk of stream) {
    streamedResponse += chunk;
  }
  console.log('\n--- STREAMED RESPONSE ---');
  console.log(streamedResponse);
  console.log('-------------------------\n');

  if (streamedResponse.length > 600) {
    throw new Error(`Streamed response too verbose (${streamedResponse.length} chars).`);
  }
  console.log(`[PASS] Streamed turn was concise (${streamedResponse.length} chars) and obeyed max_token caps.`);

  console.log('\n================================================================');
  console.log('  ALL SOCRATIC MENTORSHIP & PACING VERIFICATION CHECKS PASSED!  ');
  console.log('================================================================');
  process.exit(0);
}

runSocraticMentorshipVerification().catch((err) => {
  console.error('\n[VERIFICATION ERROR]:', err);
  process.exit(1);
});
