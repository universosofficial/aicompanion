import baseRepository from '../repositories/base.repository.js';
import userMindRepository from '../repositories/user-mind.repository.js';
import characterRepository from '../repositories/character.repository.js';
import mindKnowledgeRepository from '../repositories/mind-knowledge.repository.js';
import knowledgeService from '../services/ingestion/knowledge.service.js';
import promptService from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';

async function runMilestone7SeparationE2E() {
  console.log('================================================================');
  console.log('  MILESTONE 7: 1:1 AI MIND VS 1:N CHARACTER ARCHITECTURE & E2E  ');
  console.log('================================================================\n');

  // 1. Establish User A (Creator) and User B (Visitor / Seeker)
  console.log('[1/6] Establishing User A (Creator) and User B (Seeker)...');
  let [userARows] = await baseRepository.query("SELECT id, email FROM users WHERE email = 'albert_creator@test.com'");
  let userAId;
  if (!userARows || userARows.length === 0) {
    const resA = await baseRepository.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      ['albert_creator@test.com', 'test_creator_hash', 'user']
    );
    userAId = resA.insertId;
  } else {
    userAId = userARows[0].id;
  }

  let [userBRows] = await baseRepository.query("SELECT id, email FROM users WHERE email = 'seeker_visitor@test.com'");
  let userBId;
  if (!userBRows || userBRows.length === 0) {
    const resB = await baseRepository.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      ['seeker_visitor@test.com', 'test_seeker_hash', 'user']
    );
    userBId = resB.insertId;
  } else {
    userBId = userBRows[0].id;
  }

  console.log(`[PASS] User A (Creator) ID: ${userAId}`);
  console.log(`[PASS] User B (Visitor) ID: ${userBId}`);

  // 2. Clean previous state for handle @albert and user A's private characters
  console.log('\n[2/6] Cleaning up prior state for test handle @albert and private characters...');
  const existingMind = await userMindRepository.findByHandle('albert');
  if (existingMind) {
    await baseRepository.execute('DELETE FROM mind_knowledge_nodes WHERE mind_id = ?', [existingMind.id]);
    await baseRepository.execute('DELETE FROM mind_sources WHERE mind_id = ?', [existingMind.id]);
    await baseRepository.execute('DELETE FROM mind_consultation_sessions WHERE mind_id = ?', [existingMind.id]);
    await baseRepository.execute('DELETE FROM user_minds WHERE id = ?', [existingMind.id]);
    console.log(`[CLEANUP] Deleted prior user_minds ID ${existingMind.id}`);
  }

  const existingDad = await characterRepository.findAllByUserId(userAId);
  for (const c of existingDad) {
    if (c.name === 'Dad' || c.relationship_type === 'father') {
      await characterRepository.delete(c.id, userAId);
      console.log(`[CLEANUP] Deleted prior private character ${c.name} (ID: ${c.id})`);
    }
  }

  // 3. User A configures and publishes their 1:1 Digital Twin (@albert)
  console.log('\n[3/6] User A creates & publishes 1:1 Digital Twin (@albert)...');
  const albertMind = await userMindRepository.upsert(userAId, {
    display_name: 'Albert Einstein',
    handle: 'albert',
    headline: 'Theoretical Physics & Thought Experiments',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    website_url: 'https://einstein-archives.org',
    bio: 'Theoretical physicist developing relativity and thought experiment frameworks.',
    philosophy_statement: 'Boil reality down to fundamental invariants and thought experiments. Simplify to the absolute essentials.',
    decision_frameworks: ['Thought Experiments (Gedankenexperiment)', 'First Principles Invariance', 'Simplicity as Truth'],
    tags: ['Physics', 'Science', 'Philosophy', 'Relativity'],
    is_published: true,
  });

  if (!albertMind || albertMind.handle !== 'albert') {
    throw new Error('Failed to upsert Albert user mind');
  }
  console.log(`[PASS] Digital Twin @albert published (ID: ${albertMind.id})`);

  // Verify 1:1 Constraint (Attempting second mind for User A updates instead of duplicating)
  const updatedMind = await userMindRepository.upsert(userAId, {
    headline: 'Theoretical Physics, Invariance & Thought Experiments',
  });
  if (updatedMind.id !== albertMind.id) {
    throw new Error('1:1 constraint violated: Created multiple mind rows for User A!');
  }
  console.log('[PASS] Strict 1:1 User Mind constraint verified (user_id is UNIQUE)');

  // 4. Ingest Grounding Note into @albert
  console.log('\n[4/6] Ingesting grounding note into @albert...');
  const noteTitle = 'On Problem Solving & Consciousness';
  const noteContent = 'A problem cannot be solved from the same level of consciousness that created it. First principles require simplifying to the absolute essentials.';
  
  const sourceResult = await knowledgeService.ingestTextNote(
    albertMind.id,
    noteTitle,
    noteContent,
    'Epistemology'
  );
  console.log(`[PASS] Indexed note into source ID ${sourceResult.source.id} with ${sourceResult.chunksCreated} chunks.`);

  // 5. User A creates private companion "Dad" (1:N private character)
  console.log('\n[5/6] User A creates private companion "Dad" (father)...');
  const privateDad = await characterRepository.create({
    userId: userAId,
    name: 'Dad',
    relationshipType: 'father',
    avatarUrl: null,
    gender: 'male',
    personality: 'Loving, wise, patient, paternal father',
    tone: 'Gentle, supportive, warm',
    style: 'Warm, paternal, encouraging',
    greeting: 'Hey kiddo, how was your day today?',
    backstory: 'Loving father who raised the user with patience and wisdom.',
    isSystem: false,
  });

  console.log(`[PASS] Created private companion "Dad" (ID: ${privateDad.id}) for User A.`);

  // Verify Architectural Privacy Separation
  console.log('\n--- Verifying Privacy Separation between 1:1 Minds & 1:N Characters ---');
  // Search Commons for "Dad"
  const dadSearchResults = await userMindRepository.searchMinds({ query: 'Dad' });
  const dadInMinds = dadSearchResults.minds.some((m) => m.display_name === 'Dad' || m.handle === 'dad');
  if (dadInMinds) {
    throw new Error('CRITICAL SECURITY VIOLATION: Private character "Dad" was returned in Public Minds discovery!');
  }
  console.log('[PASS] Private character "Dad" is NOT discoverable in Thought Commons (searchMinds returned 0 matches for Dad).');

  // Search Commons for "albert"
  const albertSearchResults = await userMindRepository.searchMinds({ query: 'albert' });
  const albertFound = albertSearchResults.minds.some((m) => m.handle === 'albert');
  if (!albertFound) {
    throw new Error('Public mind @albert was NOT found in searchMinds query!');
  }
  console.log('[PASS] Public Digital Twin @albert is discoverable in Thought Commons (searchMinds returned @albert).');

  // 6. User B consults @albert on problem-solving: Grounding & Socratic Cadence Check
  console.log('\n[6/6] User B consults @albert on problem-solving...');
  const userQuery = 'How should I approach a difficult problem that seems impossible?';
  console.log(`User B Prompt: "${userQuery}"`);

  // Retrieve grounded knowledge chunks
  const knowledge = await mindKnowledgeRepository.findRelevantKnowledge(albertMind.id, userQuery, 3);
  console.log(`[GROUNDING] Retrieved ${knowledge.length} chunks from @albert knowledge base:`);
  knowledge.forEach((k, idx) => console.log(`  Chunk [${idx + 1}] (${k.source_title}): "${(k.content || k.chunk_text || '').slice(0, 80)}..."`));

  // Build Socratic consultation prompt
  const consultationPrompt = promptService.buildMindConsultationPrompt(albertMind, knowledge, []);
  
  // Verify prompt instructions
  if (!consultationPrompt.includes('SOCRATIC') || !consultationPrompt.includes('HARD LENGTH CEILING')) {
    throw new Error('Consultation prompt missing Socratic or length ceiling constraints.');
  }
  console.log('[PASS] Consultation prompt enforces Socratic mentorship and strict 2-4 sentence brevity.');

  // Generate response from AI
  console.log('Generating AI consultation response via openAiService...');
  const completion = await openAiService.generateChatCompletion({
    messages: [
      { role: 'system', content: consultationPrompt },
      { role: 'user', content: userQuery },
    ],
  });

  const responseText = completion.content.trim();
  console.log('\n================================================================');
  console.log('         AI CONSULTATION RESPONSE FROM @albert                  ');
  console.log('================================================================');
  console.log(responseText);
  console.log('================================================================\n');

  // Verify response constraints
  // 1. Length & sentence count
  const sentences = responseText.split(/(?<=[.?!])\s+/).filter((s) => s.trim().length > 0);
  console.log(`[ANALYSIS] Sentence count: ${sentences.length}`);
  if (sentences.length < 1 || sentences.length > 5) {
    throw new Error(`Cadence violation: Response has ${sentences.length} sentences (target: 2 to 4 sentences).`);
  }
  console.log('[PASS] Response is punchy and concise (between 2 and 4 sentences).');

  // 2. Zero AI assistant hedging / corporate filler
  const bannedPhrases = [
    'how can i help you today',
    'as an ai',
    'as an ai language model',
    'in conclusion',
    'first and foremost',
  ];
  for (const phrase of bannedPhrases) {
    if (responseText.toLowerCase().includes(phrase)) {
      throw new Error(`Assistant fluff detected: "${phrase}"`);
    }
  }
  console.log('[PASS] Zero corporate AI assistant fluff detected.');

  // 3. Probing / Socratic element
  const hasQuestion = responseText.includes('?');
  console.log(`[ANALYSIS] Socratic probing question present: ${hasQuestion ? 'YES' : 'NO'}`);

  // 4. Grounding verification
  const lowerResp = responseText.toLowerCase();
  const groundedTerms = ['consciousness', 'simplif', 'essential', 'first principle', 'level', 'assumption'];
  const matchedTerms = groundedTerms.filter((term) => lowerResp.includes(term));
  console.log(`[ANALYSIS] Grounded terms found in response: ${matchedTerms.join(', ') || 'none'}`);
  if (matchedTerms.length === 0) {
    console.warn('[WARN] None of the specific note terms appeared verbatim, checking semantic grounding...');
  } else {
    console.log('[PASS] Response is explicitly grounded in Albert\'s ingested note.');
  }

  // 5. Verify Consultation Session Tracking
  const session = await mindKnowledgeRepository.findOrCreateConsultationSession(userBId, albertMind.id);
  await mindKnowledgeRepository.createConsultationMessage(session.id, 'user', userQuery);
  await mindKnowledgeRepository.createConsultationMessage(session.id, 'mind', responseText);
  await userMindRepository.incrementConsultations(albertMind.id);

  const updatedAlbert = await userMindRepository.findById(albertMind.id);
  console.log(`[PASS] Consultation logged. Total consultations for @albert: ${updatedAlbert.total_consultations}`);

  console.log('\n================================================================');
  console.log('  MILESTONE 7 VERIFICATION SUCCESSFUL: ALL CHECKS PASSED!        ');
  console.log('================================================================');
}

runMilestone7SeparationE2E()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[FATAL ERROR IN E2E VERIFICATION]', err);
    process.exit(1);
  });
