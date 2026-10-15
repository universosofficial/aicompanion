import pool from '../config/database.js';
import tokenService from '../services/token.service.js';

const BASE_URL = 'http://localhost:5005';

let passedTests = 0;
let totalTests = 0;

function assert(condition, testName, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName} - ${details}`);
  }
}

async function runMvpTestSuite() {
  console.log('====================================================');
  console.log('   LUMINA / HAVEN MVP SYSTEM-WIDE VALIDATION SUITE   ');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // TEST 1: HEALTH & SYSTEM TELEMETRY
  // ----------------------------------------------------
  console.log('👉 [1/7] Testing Health & Telemetry System...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  const healthData = await healthRes.json();
  assert(healthRes.status === 200, 'Health endpoint responds 200 OK');
  assert(healthData.status === 'healthy', 'System status is healthy');
  assert(healthData.database?.status === 'connected', 'Database connection status is connected');

  // ----------------------------------------------------
  // TEST 2: AUTHENTICATION & ACCESS TOKEN CYCLE
  // ----------------------------------------------------
  console.log('\n👉 [2/7] Testing Authentication Cycle (Register / Login / Token)...');
  const testEmail = `mvp_tester_${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  // Register
  const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  const regData = await regRes.json();
  assert(regRes.status === 201, 'User registration succeeds (201 Created)');
  assert(Boolean(regData.data?.accessToken), 'Access token received upon registration');

  const accessToken = regData.data.accessToken;
  const user = regData.data.user;

  // Login
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  const loginData = await loginRes.json();
  assert(loginRes.status === 200, 'User login succeeds (200 OK)');
  assert(Boolean(loginData.data?.accessToken), 'Access token received on login');

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  };

  // ----------------------------------------------------
  // TEST 3: COMPANION PERSONA MANAGEMENT
  // ----------------------------------------------------
  console.log('\n👉 [3/7] Testing Companion Persona Engine...');
  const charsRes = await fetch(`${BASE_URL}/api/characters`, { headers: authHeaders });
  const charsData = await charsRes.json();
  assert(charsRes.status === 200, 'Fetch companions succeeds (200 OK)');
  assert(Array.isArray(charsData.data) && charsData.data.length > 0, 'Seed companions list populated');

  // Create custom companion
  const createCharRes = await fetch(`${BASE_URL}/api/characters`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      name: 'Dr. Ada Lovelace',
      personality: 'Brilliant pioneer of computing, analytical, inspiring, step-by-step explainer',
      greeting: 'Greetings! Shall we weave algorithms together?',
      relationship_type: 'mentor',
      is_public: false,
    }),
  });
  const createCharData = await createCharRes.json();
  assert(createCharRes.status === 201, 'Create custom companion succeeds (201 Created)');
  const createdCharId = createCharData.data?.id;
  assert(Boolean(createdCharId), 'New companion ID generated');

  // ----------------------------------------------------
  // TEST 4: CONVERSATION, SSE STREAMING & MESSAGE ACTIONS
  // ----------------------------------------------------
  console.log('\n👉 [4/7] Testing Conversation, Real-Time SSE Stream & Message CRUD...');
  
  // Start conversation
  const convRes = await fetch(`${BASE_URL}/api/chat/conversations`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ characterId: createdCharId }),
  });
  const convData = await convRes.json();
  assert(convRes.status === 200, 'Start conversation session succeeds (200 OK)');
  const convId = convData.data?.conversation?.id;
  assert(Boolean(convId), 'Active conversation ID created');

  // Real-time SSE Stream Turn
  const streamRes = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      characterId: createdCharId,
      conversationId: convId,
      content: 'Can you describe the concept of loops in programming in one simple paragraph?',
    }),
  });
  assert(streamRes.status === 200, 'SSE stream responds 200 OK');
  assert(streamRes.headers.get('content-type')?.includes('text/event-stream'), 'Content-Type is text/event-stream');

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let streamContent = '';
  let receivedDone = false;
  let streamedAssistantMessageId = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    streamContent += chunk;
    if (chunk.includes('"done":true')) {
      receivedDone = true;
      try {
        const match = chunk.match(/data:\s*(\{.*\})/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.assistantMessage?.id) {
            streamedAssistantMessageId = parsed.assistantMessage.id;
          }
        }
      } catch (_) {}
    }
  }
  assert(streamContent.length > 50, 'Streaming tokens received progressively');
  assert(receivedDone, 'SSE stream completes with done: true packet');

  // Message Edit & Delete Testing
  // Insert a test user message to edit
  const [insertMsg] = await pool.execute(
    'INSERT INTO messages (conversation_id, sender_type, content, token_count) VALUES (?, "user", "I want to edit this message", 6)',
    [convId]
  );
  const testMsgId = insertMsg.insertId;

  // Edit Message
  const editRes = await fetch(`${BASE_URL}/api/chat/messages/${testMsgId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ content: 'I have successfully edited this message!' }),
  });
  const editData = await editRes.json();
  assert(editRes.status === 200, 'Edit message (PATCH) succeeds (200 OK)');
  assert(editData.data?.is_edited === true, 'Message marked as is_edited = true');

  // Delete Message
  const delRes = await fetch(`${BASE_URL}/api/chat/messages/${testMsgId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  const delData = await delRes.json();
  assert(delRes.status === 200, 'Delete message (DELETE) succeeds (200 OK)');
  assert(delData.data?.deleted === true, 'Message confirmed deleted');

  // Verify memory extraction works
  const memRes = await fetch(`${BASE_URL}/api/memories/${createdCharId}`, { headers: authHeaders });
  const memData = await memRes.json();
  assert(memRes.status === 200, 'Memories bank endpoint responds 200 OK');

  // ----------------------------------------------------
  // TEST 5: SPORTS BETTING ANALYTICS & CIRCUIT BREAKER
  // ----------------------------------------------------
  console.log('\n👉 [5/7] Testing Sports Betting Engine & Quant Sizing...');
  const bankrollRes = await fetch(`${BASE_URL}/api/sports/bankroll`, { headers: authHeaders });
  const bankrollData = await bankrollRes.json();
  assert(bankrollRes.status === 200, 'Get bankroll settings succeeds (200 OK)');
  assert(Boolean(bankrollData.data?.bankroll || bankrollData.bankroll), 'Bankroll settings initialized with defaults');

  // Update bankroll
  const updateBankrollRes = await fetch(`${BASE_URL}/api/sports/bankroll`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ totalBankroll: 2500, currency: 'USD', riskTolerance: 'balanced' }),
  });
  const updateBankrollData = await updateBankrollRes.json();
  assert(updateBankrollRes.status === 200, 'Update bankroll settings succeeds (200 OK)', `status=${updateBankrollRes.status} body=${JSON.stringify(updateBankrollData)}`);
  assert(Number(updateBankrollData.data?.total_bankroll) === 2500, 'Updated bankroll reflected in DB', `data=${JSON.stringify(updateBankrollData)}`);

  // ----------------------------------------------------
  // TEST 6: THOUGHT COMMONS & PUBLIC AI MINDS
  // ----------------------------------------------------
  console.log('\n👉 [6/7] Testing Thought Commons & Public AI Minds...');
  const exploreRes = await fetch(`${BASE_URL}/api/minds/explore?sort=popular&limit=5`, { headers: authHeaders });
  const exploreData = await exploreRes.json();
  assert(exploreRes.status === 200, 'Explore AI Minds succeeds (200 OK)');
  assert(Array.isArray(exploreData.data?.minds) && exploreData.data.minds.length > 0, 'Public Minds directory populated');

  // Fetch specific mind (@elonmusk)
  const elonRes = await fetch(`${BASE_URL}/api/minds/@elonmusk`, { headers: authHeaders });
  const elonData = await elonRes.json();
  assert(elonRes.status === 200, 'Fetch Mind profile by handle (@elonmusk) succeeds (200 OK)');
  assert(elonData.data?.handle === 'elonmusk', 'Mind handle resolved correctly');

  // Stream Consultation with Elon Musk
  const consultRes = await fetch(`${BASE_URL}/api/minds/@elonmusk/consult`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ message: 'What is the first step in applying first principles thinking?' }),
  });
  assert(consultRes.status === 200, 'Consultation stream endpoint responds 200 OK');

  const consultReader = consultRes.body.getReader();
  let consultChunks = '';
  let consultGrounded = false;
  let consultDone = false;

  while (true) {
    const { done, value } = await consultReader.read();
    if (done) break;
    const txt = decoder.decode(value);
    consultChunks += txt;
    if (txt.includes('event: grounded')) consultGrounded = true;
    if (txt.includes('"done":true') || txt.includes('event: done')) consultDone = true;
  }
  assert(consultGrounded, 'Consultation response grounds in verified source doctrine');
  assert(consultDone, 'Consultation response finishes stream cleanly');

  // Ingest text into user's own Mind
  const ingestRes = await fetch(`${BASE_URL}/api/my-mind/sources/text`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      title: 'MVP Mission Manifesto',
      content: 'We build human-centric AI companions and sovereign AI minds with total privacy and end-to-end memory augmentation.',
      topic: 'Philosophy',
    }),
  });
  const ingestData = await ingestRes.json();
  assert(ingestRes.status === 201, 'Text note ingestion into My Mind succeeds (201 Created)');

  // ----------------------------------------------------
  // TEST 7: PROACTIVE CHECK-IN & WEB PUSH SUBSCRIPTIONS
  // ----------------------------------------------------
  console.log('\n👉 [7/7] Testing Proactive Engine & Push Subscriptions...');
  const vapidRes = await fetch(`${BASE_URL}/api/notifications/vapid-key`);
  const vapidData = await vapidRes.json();
  assert(vapidRes.status === 200, 'VAPID public key endpoint responds 200 OK');
  assert(Boolean(vapidData.data?.publicKey), 'VAPID public key returned');

  // Register push subscription
  const subRes = await fetch(`${BASE_URL}/api/notifications/subscribe`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test-sub-' + Date.now(),
      keys: {
        p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9t0484Tag38HsZWS0W5v5KnBzPzAO-test',
        auth: 'tH9N_test_auth_key',
      },
    }),
  });
  const subData = await subRes.json();
  assert(subRes.status === 200 || subRes.status === 201, 'Push notification subscription registered successfully');

  // Cleanup test user and companions
  console.log('\n🧹 Cleaning up test artifacts...');
  await pool.execute('DELETE FROM users WHERE id = ?', [user.id]);
  console.log('Test user and associated data cleaned up.');

  console.log('\n====================================================');
  console.log(`  VALIDATION RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('====================================================');

  await pool.end();
}

runMvpTestSuite().catch((err) => {
  console.error('[TEST SUITE CRASH]', err);
  process.exit(1);
});
