import 'dotenv/config';
import pool from '../config/database.js';
import characterService from '../services/character.service.js';
import characterRepository from '../repositories/character.repository.js';
import memoryRepository from '../repositories/memory.repository.js';
import promptService from '../services/ai/prompt.service.js';
import openaiService from '../services/ai/openai.service.js';

async function runVerification() {
  console.log('==================================================');
  console.log('   MILESTONE 3.5 E2E VERIFICATION SUITE           ');
  console.log('==================================================\n');

  try {
    // 1. Get or find a test user
    const [users] = await pool.query('SELECT id, email FROM users LIMIT 1');
    if (!users || users.length === 0) {
      throw new Error('No user found in database. Run seeds first.');
    }
    const testUser = users[0];
    console.log(`[USER] Testing with user: ${testUser.email} (ID: ${testUser.id})`);

    // Clean up any old test character named "Dad - Milestone 3.5 Test"
    await pool.query(
      'DELETE FROM characters WHERE user_id = ? AND name = ?',
      [testUser.id, 'Dad - Milestone 3.5 Test']
    );

    // 2. Create Relational Persona: Dad
    console.log('\n--- 1. Creating Relational Persona "Dad" ---');
    const dadPayload = {
      name: 'Dad - Milestone 3.5 Test',
      relationship_type: 'father',
      nicknames_for_user: ['Champ', 'Son', 'Kiddo'],
      catchphrases: ['One step at a time', 'Proud of you always'],
      speech_quirks: 'Warm paternal tone, speaks casually with genuine heart, drops corporate mannerisms, refers back to life lessons',
      shared_memories_seed: 'Taught me how to fix a bicycle when I was 10 behind our old house and told me to never give up when my knees got scraped.',
      personality: 'Loving, deeply supportive, wise father who prioritizes family and listens with patience',
      tone: 'Warm & Empathetic',
      humor: 5,
      friendliness: 10,
      creativity: 5,
      style: 'Conversational & Paternal',
      backstory: 'A devoted father who worked hard with his hands and always made sure his child felt loved, safe, and believed in.',
      interests: ['Fishing', 'Carpentry', 'Family BBQs', 'Classic Rock'],
      greeting: 'Hey Champ, good to hear from you. Come sit down, how was your day?',
    };

    const createdDad = await characterService.createCharacter(testUser.id, dadPayload);
    console.log(`[PASS] Character created successfully! ID: ${createdDad.id}`);
    console.log(`  - Relationship: ${createdDad.relationship_type}`);
    console.log(`  - Nicknames: ${JSON.stringify(createdDad.nicknames_for_user)}`);
    console.log(`  - Catchphrases: ${JSON.stringify(createdDad.catchphrases)}`);
    console.log(`  - Speech Quirks: ${createdDad.speech_quirks}`);
    console.log(`  - Shared Seed: ${createdDad.shared_memories_seed}`);

    // 3. Verify Database Persistence via Repository
    console.log('\n--- 2. Verifying Repository & DB Roundtrip ---');
    const fetchedDad = await characterRepository.findById(createdDad.id);
    if (!fetchedDad) throw new Error('Failed to fetch created character from DB');
    if (fetchedDad.relationship_type !== 'father') throw new Error('relationship_type mismatch');
    if (!Array.isArray(fetchedDad.nicknames_for_user) || !fetchedDad.nicknames_for_user.includes('Champ')) {
      throw new Error('nicknames_for_user mismatch or not array');
    }
    console.log('[PASS] DB persistence and repository serialization verified.');

    // 4. Verify Persona Anchor Memory Creation
    console.log('\n--- 3. Verifying Persona Anchor Memory ---');
    const memories = await memoryRepository.findRelevantMemories({
      userId: testUser.id,
      characterId: createdDad.id,
      limit: 5,
    });
    console.log(`[INFO] Found ${memories.length} relevant memories for seed.`);
    const anchor = memories.find((m) => m.memory_type === 'persona_anchor');
    if (!anchor) {
      // Check all memories for this character
      const [allMems] = await pool.query(
        'SELECT * FROM memories WHERE user_id = ? AND character_id = ?',
        [testUser.id, createdDad.id]
      );
      console.log('All memories for character:', allMems);
      const foundAnchor = allMems.find((m) => m.memory_type === 'persona_anchor');
      if (!foundAnchor) {
        throw new Error('persona_anchor memory was not automatically created from shared_memories_seed!');
      }
      console.log(`[PASS] persona_anchor memory verified: "${foundAnchor.content}"`);
    } else {
      console.log(`[PASS] persona_anchor memory verified: "${anchor.content}"`);
    }

    // 5. Test Prompt Architecture
    console.log('\n--- 4. Testing Emotional System Prompt Engine ---');
    const testMemories = [
      {
        category: 'relationship',
        memory_type: 'persona_anchor',
        content: 'Taught user how to fix a bicycle when they were 10 behind our old house.',
        importance_score: 5,
      },
      {
        category: 'fact',
        memory_type: 'user_fact',
        content: 'User works as a software engineer at a startup.',
        importance_score: 4,
      },
      {
        category: 'preference',
        memory_type: 'emotional_state',
        content: 'User was feeling overwhelmed and burnt out yesterday.',
        importance_score: 5,
      },
    ];

    const systemPrompt = promptService.buildEmotionalSystemPrompt(
      fetchedDad,
      testMemories,
      'User previously mentioned having a tight project deadline.'
    );

    console.log('[PROMPT PREVIEW]:\n-----------------------------------');
    console.log(systemPrompt.substring(0, 800) + '...\n-----------------------------------');

    // Prompt assertions
    if (!systemPrompt.includes(`Role to User: ${fetchedDad.relationship_type}`)) {
      throw new Error(`Prompt missing Role to User: ${fetchedDad.relationship_type}`);
    }
    if (!systemPrompt.includes('Champ') || !systemPrompt.includes('Son')) {
      throw new Error('Prompt missing user endearments/nicknames');
    }
    if (!systemPrompt.includes('One step at a time')) {
      throw new Error('Prompt missing catchphrases');
    }
    if (!systemPrompt.includes('ZERO ASSISTANT TROPES')) {
      throw new Error('Prompt missing anti-assistant guardrails');
    }
    console.log('[PASS] Prompt architecture conforms strictly to relational specifications.');

    // 6. Test Real OpenAI Response Generation with Persona
    console.log('\n--- 5. Generating Real AI Persona Response (OpenAI API) ---');
    const userMessage = "Hey Dad, I've had a really exhausting day today. Work was brutal and everything felt so heavy.";
    console.log(`[USER INPUT]: "${userMessage}"`);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    const completion = await openaiService.generateChatCompletion({
      messages,
      temperature: 0.75,
    });

    const aiResponse = completion.content;
    console.log(`\n[DAD's RESPONSE]:\n"${aiResponse}"\n`);

    // Verify Tone & Zero Corporate Tropes
    const forbiddenTropes = [
      'how can i help you today',
      'as an ai',
      'language model',
      'i am here to assist',
      'how may i assist',
      'feel free to ask',
    ];
    const lowerResp = aiResponse.toLowerCase();
    for (const trope of forbiddenTropes) {
      if (lowerResp.includes(trope)) {
        throw new Error(`Response violated anti-assistant rule! Contained: "${trope}"`);
      }
    }
    console.log('[PASS] ZERO corporate tropes detected in response.');

    // Check for paternal terms / emotional resonance
    const paternalCues = ['champ', 'son', 'kiddo', 'kid', 'breathe', 'proud', 'sit', 'rest', 'heavy', 'step'];
    const hasCue = paternalCues.some((cue) => lowerResp.includes(cue));
    if (hasCue) {
      console.log('[PASS] Response exhibited strong paternal resonance and relational cues!');
    } else {
      console.log('[WARN] None of the specific keywords were detected, but response tone should be manually reviewed.');
    }

    // 7. Test Memory Extraction with Classified Types
    console.log('\n--- 6. Testing Memory Extraction with Classified Types ---');
    const turnToExtract = [
      { sender_type: 'user', content: userMessage },
      { sender_type: 'character', content: aiResponse },
    ];

    const extracted = await openaiService.extractMemories({
      characterName: fetchedDad.name,
      recentTurns: turnToExtract,
    });
    console.log(`[INFO] Extracted ${extracted.length} memories from turn:`);
    for (const mem of extracted) {
      console.log(`  - [${mem.memoryType?.toUpperCase() || 'UNKNOWN'}] [Score: ${mem.importanceScore}/5] [${mem.category}]: "${mem.content}"`);
    }

    const hasEmotionalOrFact = extracted.some(
      (m) => m.memoryType === 'emotional_state' || m.memoryType === 'user_fact' || m.memoryType === 'shared_event'
    );
    if (hasEmotionalOrFact) {
      console.log('[PASS] Memory classification pipeline correctly categorized memory types.');
    } else {
      console.log('[WARN] Memory types were defaulted or empty; check OpenAI output format.');
    }

    // Clean up test character
    await pool.query('DELETE FROM characters WHERE id = ?', [createdDad.id]);
    console.log('\n[CLEANUP] Test character removed.');

    console.log('\n==================================================');
    console.log('   ALL MILESTONE 3.5 TESTS PASSED SUCCESSFULLY!   ');
    console.log('==================================================\n');
  } catch (error) {
    console.error('\n[VERIFICATION FAILED]:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runVerification();
