import characterRepository from '../repositories/character.repository.js';
import mindRepository from '../repositories/mind.repository.js';
import sourceRepository from '../repositories/source.repository.js';
import ingestionService from '../services/ingestion/ingestion.service.js';
import { buildPublicMindSystemPrompt } from '../services/ai/prompt.service.js';
import baseRepository from '../repositories/base.repository.js';

async function runTest() {
  console.log('--- Testing Milestone 7 Backend Components ---');

  // 1. Get or create a test character
  const [existing] = await baseRepository.query('SELECT id, user_id FROM characters LIMIT 1');
  if (!existing || existing.length === 0) {
    console.log('No existing character, creating one...');
    return;
  }
  const char = existing[0];
  console.log(`Using character ID: ${char.id}`);

  // 2. Test publishing character as public mind
  const handle = `mind_test_${Date.now()}`.slice(0, 20);
  console.log(`Publishing mind with handle: @${handle}`);
  await characterRepository.update(char.id, char.user_id, {
    is_public: true,
    handle,
    headline: 'Pragmatic systems thinker & Bootstrapped Founder',
    philosophy_statement: 'Resilient architectures survive through simplicity, idempotency, and explicit boundaries.',
    mental_models: ['Inversion', 'Idempotent State Machines', 'Chesterton’s Fence'],
    tags: ['Engineering', 'Architecture', 'Philosophy'],
  });

  const mind = await mindRepository.findByHandle(handle);
  console.log('Mind found by handle:', mind?.name, mind?.handle, mind?.headline);
  if (!mind || mind.handle !== handle) {
    throw new Error('Failed to find mind by handle');
  }

  // 3. Test Ingesting a document (.txt / .md)
  console.log('Testing document ingestion...');
  const sampleText = `
# The 3 Rules of Resilient Software Engineering

Rule 1: Idempotency by Default.
Every mutation in distributed state should be safe to retry infinitely without side effects.
When you design payment or memory sync pipelines, generate a deterministic idempotency key.

Rule 2: Explicit Failure Boundaries.
Never let an external upstream dependency take down your core transaction loop.
Use circuit breakers and fallback offline generators.

Rule 3: Understand Chesterton’s Fence before refactoring.
Do not remove a line of legacy code until you understand why it was put there in the first place.
`;

  const source = await ingestionService.ingestDocument({
    characterId: char.id,
    fileBuffer: Buffer.from(sampleText, 'utf-8'),
    fileName: 'resilient_engineering.md',
    mimetype: 'text/markdown',
    customTitle: 'Resilient Engineering Manifesto',
  });

  console.log(`Source created: ID ${source.id}, status: ${source.status}, chunkCount: ${source.chunk_count}`);
  if (source.status !== 'indexed' || source.chunk_count === 0) {
    throw new Error(`Ingestion failed: ${source.error_message || 'status not indexed'}`);
  }

  // 4. Test knowledge search
  console.log('Testing knowledge retrieval...');
  const chunks = await mindRepository.findRelevantKnowledge(char.id, 'What is rule 1 about idempotency?');
  console.log(`Retrieved ${chunks.length} knowledge chunks.`);
  if (chunks.length === 0) {
    throw new Error('Knowledge retrieval returned 0 chunks');
  }
  console.log('Top Chunk Title:', chunks[0].title);
  console.log('Top Chunk Snippet:', chunks[0].content.slice(0, 100));

  // 5. Test public mind system prompt
  console.log('Testing public mind prompt builder...');
  const prompt = buildPublicMindSystemPrompt(mind, chunks);
  console.log('System prompt length:', prompt.length);
  if (!prompt.includes(mind.headline) || !prompt.includes('Idempotency by Default')) {
    throw new Error('System prompt missing headline or knowledge content');
  }

  // 6. Test searchMinds
  console.log('Testing searchMinds explore...');
  const searchRes = await mindRepository.searchMinds({ query: 'Resilient', tag: 'Engineering' });
  console.log(`Explore search returned ${searchRes.total} total matching minds.`);
  if (searchRes.total === 0) {
    throw new Error('Explore search did not find published mind');
  }

  // Clean up source
  await sourceRepository.deleteSource(source.id, char.id);
  console.log('Source cleaned up successfully.');

  console.log('--- ALL BACKEND CHECKS PASSED! ---');
  process.exit(0);
}

runTest().catch((e) => {
  console.error('TEST ERROR:', e);
  process.exit(1);
});
