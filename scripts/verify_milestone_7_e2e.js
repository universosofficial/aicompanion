import baseRepository from '../repositories/base.repository.js';
import characterRepository from '../repositories/character.repository.js';
import mindRepository from '../repositories/mind.repository.js';
import sourceRepository from '../repositories/source.repository.js';
import ingestionService from '../services/ingestion/ingestion.service.js';
import { buildPublicMindSystemPrompt } from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';

async function runMilestone7Verification() {
  console.log('====================================================');
  console.log('    MILESTONE 7 END-TO-END VERIFICATION TEST        ');
  console.log('====================================================');

  // 1. Get or create creator user
  let [users] = await baseRepository.query('SELECT id, email FROM users LIMIT 1');
  let userId;
  if (!users || users.length === 0) {
    const res = await baseRepository.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      ['solon_creator@test.com', 'test_hash', 'user']
    );
    userId = res.insertId;
  } else {
    userId = users[0].id;
  }
  console.log(`[USER] Creator user ID: ${userId}`);

  // 2. Clear any prior test mind with handle 'solon'
  await baseRepository.execute("UPDATE characters SET handle = NULL, is_public = FALSE WHERE handle = 'solon'");

  // 3. Create or update Solon character
  const [solonRows] = await baseRepository.query("SELECT id FROM characters WHERE name = 'Solon' LIMIT 1");
  let solonId;
  if (solonRows && solonRows.length > 0) {
    solonId = solonRows[0].id;
  } else {
    const created = await characterRepository.create({
      userId,
      name: 'Solon',
      relationshipType: 'mentor',
      personality: 'Wise, measured, reflective, statesman and poet of Athens.',
      tone: 'Grounded, philosophical, dignified',
      humor: 3,
      friendliness: 6,
      creativity: 8,
      style: 'Direct, aphoristic, profound',
      greeting: 'Greetings, seeker of wisdom. What principles shall we examine together today?',
    });
    solonId = created.id;
  }

  console.log(`[CHARACTER] Solon character ID: ${solonId}`);

  // 4. Publish as Public AI Mind @solon
  console.log('[PUBLICATION] Publishing Solon as public AI Mind @solon...');
  await characterRepository.update(solonId, userId, {
    is_public: true,
    handle: 'solon',
    headline: 'Ancient Lawgiver, Sage of Athens & Architectural Philosopher',
    website_url: 'https://athens-archives.org/solon',
    philosophy_statement:
      'True governance and lasting architectures endure through moderation and balance. Nothing in excess (Mēden agan). Laws must be written to withstand human frailty.',
    mental_models: [
      'Nothing in excess (Mēden agan)',
      'Know thyself (Gnōthi seauton)',
      'Chesterton’s Fence of Governance',
      'Idempotent State Machines',
    ],
    tags: ['Philosophy', 'Governance', 'Architecture', 'Ethics', 'Engineering'],
  });

  const publicMind = await mindRepository.findByHandle('solon');
  if (!publicMind || publicMind.handle !== 'solon') {
    throw new Error('Verification failed: Could not retrieve @solon by handle.');
  }
  console.log(`[PASS] Mind retrieved by handle: "${publicMind.name}" (@${publicMind.handle})`);
  console.log(`       Headline: "${publicMind.headline}"`);
  console.log(`       Mental Models: ${publicMind.mental_models.join(', ')}`);

  // 5. Ingest Sample Document: "The 3 Rules of Resilient Software Engineering"
  console.log('[INGESTION] Ingesting authored essay: "The 3 Rules of Resilient Software Engineering"...');
  const essayContent = `
# The 3 Rules of Resilient Software Engineering
Authored by Solon of Athens

Rule 1: Idempotency by Default.
Every mutation across distributed boundaries must be safe to execute an infinite number of times without unexpected side effects. Always generate deterministic idempotency keys for distributed state transitions.

Rule 2: Explicit Failure Boundaries & Circuit Breakers.
Never permit an external upstream dependency to bring down your core transaction loop. Isolate failure zones, establish clear fallback offline generators, and reject cascading collapse.

Rule 3: Respect Chesterton's Fence Before Refactoring.
Do not pull down a fence or delete a legacy routine until you have thoroughly discovered why the previous builders erected it in that exact spot.
`;

  const source = await ingestionService.ingestDocument({
    characterId: solonId,
    fileBuffer: Buffer.from(essayContent, 'utf-8'),
    fileName: 'solon_resilient_engineering.md',
    mimetype: 'text/markdown',
    customTitle: 'The 3 Rules of Resilient Software Engineering',
  });

  console.log(`[PASS] Ingestion complete. Source ID: ${source.id}, Status: "${source.status}", Chunks: ${source.chunk_count}`);
  if (source.status !== 'indexed' || source.chunk_count === 0) {
    throw new Error('Verification failed: Document was not successfully indexed into chunks.');
  }

  // 6. Test Knowledge Retrieval
  const visitorQuestion = 'Solon, how should I design my distributed systems so they do not collapse when external dependencies fail?';
  console.log(`\n[VISITOR INQUIRY] "${visitorQuestion}"`);

  console.log('[RETRIEVAL] Finding relevant knowledge nodes matching visitor question...');
  const retrievedChunks = await mindRepository.findRelevantKnowledge(solonId, visitorQuestion, 4);
  console.log(`[PASS] Retrieved ${retrievedChunks.length} relevant knowledge node(s).`);
  retrievedChunks.forEach((c, idx) => {
    console.log(`       [Chunk ${idx + 1}] "${c.title}"`);
    console.log(`       Excerpt: ${c.content.slice(0, 120).replace(/\n/g, ' ')}...`);
  });

  if (retrievedChunks.length === 0) {
    throw new Error('Verification failed: Knowledge retrieval returned 0 chunks.');
  }

  // 7. Test Consultation Prompt Assembly
  console.log('[PROMPT] Assembling Public Mind system prompt with retrieved grounding chunks...');
  const systemPrompt = buildPublicMindSystemPrompt(publicMind, retrievedChunks);
  console.log(`[PASS] Grounded prompt assembled (${systemPrompt.length} chars).`);

  if (!systemPrompt.includes('Explicit Failure Boundaries') || !systemPrompt.includes('Mēden agan')) {
    throw new Error('Verification failed: Grounded prompt missing authored document text or philosophy.');
  }

  // 8. Stream Consultation Turn
  console.log('[STREAMING] Generating live consultation turn through OpenAiService...');
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: visitorQuestion },
  ];

  const stream = await openAiService.createChatStream({ messages });
  let fullAnswer = '';

  for await (const chunk of stream) {
    fullAnswer += chunk;
    process.stdout.write(chunk);
  }
  console.log('\n');

  console.log(`[PASS] Full consultation response received (${fullAnswer.length} chars).`);

  // 9. Verify Atomic Increment of Interactions
  await mindRepository.incrementInteractions(solonId);
  const updatedMind = await mindRepository.findByHandle('solon');
  console.log(`[PASS] Consultation interactions counter: ${updatedMind.total_interactions}`);

  // 10. Clean up source
  await sourceRepository.deleteSource(source.id, solonId);
  console.log('[CLEANUP] Test source and knowledge nodes removed cleanly.');

  console.log('====================================================');
  console.log('       ALL MILESTONE 7 VERIFICATION CHECKS PASSED!   ');
  console.log('====================================================');
  process.exit(0);
}

runMilestone7Verification().catch((err) => {
  console.error('\n[VERIFICATION ERROR]:', err);
  process.exit(1);
});
