import baseRepository from '../repositories/base.repository.js';
import characterRepository from '../repositories/character.repository.js';
import mindRepository from '../repositories/mind.repository.js';
import sourceRepository from '../repositories/source.repository.js';
import conversationRepository from '../repositories/conversation.repository.js';
import messageRepository from '../repositories/message.repository.js';
import knowledgeService from '../services/ingestion/knowledge.service.js';
import { buildPublicMindSystemPrompt } from '../services/ai/prompt.service.js';
import openAiService from '../services/ai/openai.service.js';

async function runMilestone7NetworkE2E() {
  console.log('================================================================');
  console.log('  MILESTONE 7: DIGITAL TWIN MINDS NETWORK & CONSULTING E2E TEST ');
  console.log('================================================================\n');

  // 1. Establish User A (Creator) and User B (Consultant)
  console.log('[1/7] Initializing User A (Creator) and User B (Consultant)...');
  let [userARows] = await baseRepository.query("SELECT id, email FROM users WHERE email = 'elon_creator@test.com'");
  let userAId;
  if (!userARows || userARows.length === 0) {
    const resA = await baseRepository.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      ['elon_creator@test.com', 'test_creator_hash', 'user']
    );
    userAId = resA.insertId;
  } else {
    userAId = userARows[0].id;
  }

  let [userBRows] = await baseRepository.query("SELECT id, email FROM users WHERE email = 'consultant_seeker@test.com'");
  let userBId;
  if (!userBRows || userBRows.length === 0) {
    const resB = await baseRepository.execute(
      'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
      ['consultant_seeker@test.com', 'test_seeker_hash', 'user']
    );
    userBId = resB.insertId;
  } else {
    userBId = userBRows[0].id;
  }

  console.log(`[PASS] User A (Creator) ID: ${userAId}`);
  console.log(`[PASS] User B (Consultant) ID: ${userBId}`);

  // 2. Clean up any previous test state for @elonmusk
  console.log('\n[2/7] Cleaning prior state for handle @elonmusk...');
  const [existingMusk] = await baseRepository.query("SELECT id FROM characters WHERE handle = 'elonmusk'");
  if (existingMusk && existingMusk.length > 0) {
    const priorId = existingMusk[0].id;
    await baseRepository.execute('DELETE FROM mind_knowledge_nodes WHERE character_id = ?', [priorId]);
    await baseRepository.execute('DELETE FROM mind_sources WHERE character_id = ?', [priorId]);
    await baseRepository.execute('DELETE FROM mind_subscriptions WHERE character_id = ?', [priorId]);
    await baseRepository.execute('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE character_id = ?)', [priorId]);
    await baseRepository.execute('DELETE FROM conversations WHERE character_id = ?', [priorId]);
    await baseRepository.execute('DELETE FROM characters WHERE id = ?', [priorId]);
    console.log(`[CLEANUP] Deleted prior character ID ${priorId}`);
  }

  // 3. User A creates and publishes Elon Musk Digital Twin
  console.log('\n[3/7] User A creates Elon Musk Digital Twin Mind...');
  const elon = await characterRepository.create({
    userId: userAId,
    name: 'Elon Musk',
    relationshipType: 'mentor',
    personality: 'Hyper-focused, first-principles driven, candid, impatient with bureaucracy.',
    tone: 'Direct, analytical, dry humor, vision-oriented',
    humor: 6,
    friendliness: 5,
    creativity: 9,
    style: 'Short sentences, physics references, questioning assumptions',
    greeting: 'What technical bottleneck are we solving today? First principles only.',
    avatar_url: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=400',
  });

  const elonId = elon.id;
  console.log(`[PASS] Created Elon Musk character ID: ${elonId}`);

  console.log('Publishing to Public Mind Network as @elonmusk (Verified)...');
  await characterRepository.update(elonId, userAId, {
    is_public: true,
    is_verified: true,
    handle: 'elonmusk',
    headline: 'Technologist, Chief Engineer at SpaceX & Tesla CEO',
    website_url: 'https://x.com/elonmusk',
    philosophy_statement:
      'Boil things down to their fundamental truths and reason up from there, rather than reasoning by analogy. Physics is the only law; everything else is a recommendation.',
    decision_frameworks: [
      'First Principles Reasoning (physics-based fundamental truths)',
      'The 5-Step Engineering Process',
      'Question every requirement from smart people',
      'Delete the part or process step — if you do not add back 10%, you are not deleting enough',
      'Never optimize something that should not exist',
      'Automate dead last',
    ],
    tags: ['Engineering', 'Physics', 'Manufacturing', 'Aerospace', 'AI'],
  });

  const publishedMind = await mindRepository.findByHandle('elonmusk');
  if (!publishedMind || publishedMind.handle !== 'elonmusk' || !publishedMind.is_verified) {
    throw new Error('Verification failed: Elon Musk public mind not properly published or verified.');
  }
  console.log(`[PASS] Published Mind verified: "${publishedMind.name}" (@${publishedMind.handle})`);
  console.log(`       Headline: ${publishedMind.headline}`);
  console.log(`       Verified Status: ${publishedMind.is_verified}`);
  console.log(`       Decision Frameworks (${publishedMind.decision_frameworks.length}): ${publishedMind.decision_frameworks.slice(0, 3).join(' | ')}...`);

  // 4. Ingest The 5-Step Engineering Process Document
  console.log('\n[4/7] Ingesting "The 5-Step Engineering Process" Knowledge Document...');
  const engineeringProcessDoc = `
# The 5-Step Engineering Process
By Elon Musk

This is the rigorous algorithm used at SpaceX and Tesla to design rockets, electric vehicles, and factories:

1. Step 1: Make requirements less dumb.
Your requirements are definitely dumb to some degree; it doesn't matter who gave them to you. It's especially dangerous if a smart person gave you the requirements, because you might not question them enough. Everyone must be both a chief engineer and a consumer of requirements.

2. Step 2: Delete the part or process step.
If parts are not being added back into the design at least 10% of the time, not enough parts are being deleted. The bias must be toward deleting parts and deleting processes. Whatever is not there cannot break, cannot cause weight penalties, and costs nothing.

3. Step 3: Simplify or optimize.
The most common error of a smart engineer is to optimize a thing that should not exist. Only once you have deleted the part or step should you spend brainpower simplifying what remains.

4. Step 4: Accelerate cycle time.
You're moving too slowly, go faster! But don't go faster until you have first worked on the other three steps. If you are digging your grave, don't dig it faster.

5. Step 5: Automate.
The final step is to automate. Put automation dead last. A huge mistake made at the Tesla Model 3 ramp was putting robots into places where humans should have been, trying to automate requirements that shouldn't have existed. Automate only after you have questioned requirements, deleted parts, and simplified.
`;

  const { source, chunksCreated } = await knowledgeService.ingestDocument(
    elonId,
    Buffer.from(engineeringProcessDoc, 'utf-8'),
    '5_step_engineering_process.md',
    {
      title: 'The 5-Step Engineering Process',
      topic: 'Engineering & Manufacturing Algorithms',
    }
  );

  console.log(`[PASS] Ingestion complete. Source ID: ${source.id}, Status: "${source.status}", Chunks: ${chunksCreated}`);
  if (source.status !== 'indexed' || chunksCreated === 0) {
    throw new Error('Verification failed: Document was not indexed into chunks.');
  }

  // 5. User B Searches and Discovers Elon Musk in Public Registry
  console.log('\n[5/7] User B tests Mind Discovery & Subscribes ("Add to My Minds")...');
  const searchResults = await mindRepository.searchMinds({
    query: 'Elon',
    limit: 5,
  });

  const foundElon = searchResults.minds.find((m) => m.handle === 'elonmusk');
  if (!foundElon) {
    throw new Error('Verification failed: Elon Musk mind not found in search results.');
  }
  console.log(`[PASS] Found in registry search: "${foundElon.name}" (@${foundElon.handle}), Verified: ${foundElon.is_verified}`);

  // User B Subscribes to Elon Musk
  console.log('User B subscribing to @elonmusk...');
  await mindRepository.subscribeUser(userBId, elonId);
  const isSubscribed = await mindRepository.isSubscribed(userBId, elonId);
  if (!isSubscribed) {
    throw new Error('Verification failed: User B subscription failed.');
  }
  console.log(`[PASS] User B successfully subscribed to @elonmusk.`);

  // Verify Elon Musk appears in User B's companion list
  const userBCharacters = await characterRepository.findAllByUserId(userBId);
  const elonInUserBList = userBCharacters.find((c) => c.id === elonId);
  if (!elonInUserBList || !elonInUserBList.is_subscribed) {
    throw new Error("Verification failed: Subscribed mind does not appear in User B's active companion list.");
  }
  console.log(`[PASS] Verified @elonmusk appears in User B's active companion list with is_subscribed: true.`);

  // 6. User B Conducts Private Multi-Tenant Consultation
  console.log('\n[6/7] User B conducts private grounded consultation...');
  const userBQuestion =
    "Elon, our factory line assembly takes twice as long as projected. We are about to spend $2.5M on robotic arms to automate the manual inspection and assembly stations to speed things up. How should we tackle this?";
  console.log(`[CONSULTATION PROMPT]: "${userBQuestion}"\n`);

  // Retrieve matching knowledge nodes
  const matchedChunks = await mindRepository.findRelevantKnowledge(elonId, userBQuestion, 4);
  console.log(`[PASS] Retrieved ${matchedChunks.length} relevant knowledge chunks for grounding:`);
  matchedChunks.forEach((c, idx) => {
    console.log(`  [Chunk ${idx + 1}] Source: "${c.source_title}", Topic: "${c.topic}"`);
    console.log(`               Preview: ${c.content.slice(0, 100).replace(/\n/g, ' ')}...`);
  });

  if (matchedChunks.length === 0) {
    throw new Error('Verification failed: Knowledge retrieval returned 0 chunks.');
  }

  // Create isolated conversation for User B
  const userBConversation = await conversationRepository.create({
    userId: userBId,
    characterId: elonId,
    title: 'Factory Line Automation Consultation',
  });

  await messageRepository.create({
    conversationId: userBConversation.id,
    senderType: 'user',
    content: userBQuestion,
    tokenCount: Math.ceil(userBQuestion.length / 4),
  });

  // Assemble system prompt with grounded knowledge
  const systemPrompt = buildPublicMindSystemPrompt(publishedMind, matchedChunks);
  const openAiMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userBQuestion },
  ];

  console.log('\nStreaming consultation response from AI Orchestrator:');
  console.log('------------------------------------------------------------');
  const stream = await openAiService.createChatStream({ messages: openAiMessages });
  let fullResponse = '';
  for await (const token of stream) {
    fullResponse += token;
    process.stdout.write(token);
  }
  console.log('\n------------------------------------------------------------');

  // Verify response fidelity and grounding
  const lowerResp = fullResponse.toLowerCase();
  const hasStepOrAutomate =
    lowerResp.includes('automate') ||
    lowerResp.includes('step') ||
    lowerResp.includes('delete') ||
    lowerResp.includes('optimize') ||
    lowerResp.includes('requirement');

  if (!hasStepOrAutomate) {
    throw new Error('Verification failed: Response did not reflect the 5-step engineering framework.');
  }
  console.log(`[PASS] Response successfully grounded in 5-Step Process (${fullResponse.length} chars).`);

  // Save assistant message to User B's conversation
  await messageRepository.create({
    conversationId: userBConversation.id,
    senderType: 'assistant',
    content: fullResponse,
    tokenCount: Math.ceil(fullResponse.length / 4),
  });

  // Verify Multi-Tenant Privacy: Check conversations in DB
  const [userBConvs] = await baseRepository.query('SELECT user_id, character_id FROM conversations WHERE id = ?', [userBConversation.id]);
  if (userBConvs[0].user_id !== userBId) {
    throw new Error('Verification failed: Multi-tenant privacy breach. User B conversation owned by wrong user.');
  }
  console.log(`[PASS] Multi-tenant isolation verified: Conversation ${userBConversation.id} is strictly owned by User B (ID: ${userBId}).`);

  // 7. Verify Atomic Increment & Subscription Count
  console.log('\n[7/7] Verifying Mind stats, subscriber counts, and interactions...');
  await mindRepository.incrementInteractions(elonId);
  const [statsMind] = await baseRepository.query('SELECT total_subscribers, total_interactions FROM characters WHERE id = ?', [elonId]);
  console.log(`[PASS] Stats: Subscribers: ${statsMind[0].total_subscribers}, Interactions: ${statsMind[0].total_interactions}`);
  if (statsMind[0].total_subscribers < 1 || statsMind[0].total_interactions < 1) {
    throw new Error('Verification failed: Subscriber count or interaction counter failed to increment.');
  }

  // Clean up test data
  console.log('\n[CLEANUP] Cleaning up test data...');
  await sourceRepository.deleteSource(source.id, elonId);
  await baseRepository.execute('DELETE FROM mind_subscriptions WHERE character_id = ?', [elonId]);
  await baseRepository.execute('DELETE FROM messages WHERE conversation_id = ?', [userBConversation.id]);
  await baseRepository.execute('DELETE FROM conversations WHERE id = ?', [userBConversation.id]);
  await baseRepository.execute('DELETE FROM characters WHERE id = ?', [elonId]);
  await baseRepository.execute('DELETE FROM users WHERE id IN (?, ?)', [userAId, userBId]);
  console.log('[PASS] Test cleanup completed successfully.');

  console.log('\n================================================================');
  console.log('  MILESTONE 7 VERIFICATION SUCCESSFUL: ALL CHECKS PASSED!        ');
  console.log('================================================================');
  process.exit(0);
}

runMilestone7NetworkE2E().catch((err) => {
  console.error('\n[VERIFICATION ERROR]:', err);
  process.exit(1);
});
