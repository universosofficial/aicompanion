import mysql from 'mysql2/promise';
import { env } from './env.js';

const poolConfig = env.DATABASE_URL
  ? {
      uri: env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: env.DB_CONNECTION_LIMIT,
      maxIdle: 15,
      idleTimeout: 60000,
      queueLimit: 250,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: 'utf8mb4',
      ...(env.DB_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    }
  : {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      waitForConnections: true,
      connectionLimit: env.DB_CONNECTION_LIMIT,
      maxIdle: 15,
      idleTimeout: 60000,
      queueLimit: 250,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: 'utf8mb4',
      ...(env.DB_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    };

export const pool = mysql.createPool(poolConfig);

/**
 * Verifies database connectivity with retry attempts.
 * @param {number} retries - Number of retry attempts.
 * @param {number} delayMs - Delay in ms between retries.
 * @returns {Promise<boolean>}
 */
export async function testConnection(retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const connection = await pool.getConnection();
      await connection.ping();
      try {
        await connection.query(
          `UPDATE characters
           SET personality = 'Sharp, collaborative football match forecaster and betting options sparring partner. Forecasts how a match will play out in plain English, grills your betting options to expose traps, and helps you lock in the smartest play.',
               greeting = CONCAT('Hey mate! I''m ', name, ', your Match Forecaster & Options Copilot. Tell me which match you''re looking at and the betting options you have in mind—let''s grill them together!')
           WHERE (is_sports_analyst = 1 OR LOWER(name) LIKE '%bet%' OR LOWER(name) LIKE '%quant%' OR LOWER(personality) LIKE '%poisson%' OR LOWER(personality) LIKE '%kelly%')
             AND (LOWER(personality) LIKE '%poisson%' OR LOWER(personality) LIKE '%kelly%' OR LOWER(greeting) LIKE '%quantitative%')`
        );
      } catch (_) {}

      // Auto-migrate Paid AI-to-Human Direct Handoff columns idempotently
      const alterStatements = [
        `ALTER TABLE user_minds ADD COLUMN direct_chat_enabled TINYINT(1) NOT NULL DEFAULT 1`,
        `ALTER TABLE user_minds ADD COLUMN direct_chat_price DECIMAL(10,2) NOT NULL DEFAULT 25.00`,
        `ALTER TABLE user_minds ADD COLUMN direct_chat_sla VARCHAR(140) NOT NULL DEFAULT 'Replies personally within a few hours'`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN chat_mode VARCHAR(32) NOT NULL DEFAULT 'ai'`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN is_paid_unlocked TINYINT(1) NOT NULL DEFAULT 0`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN handoff_summary TEXT NULL`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN escalation_note TEXT NULL`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN unread_for_creator INT NOT NULL DEFAULT 0`,
        `ALTER TABLE mind_consultation_sessions ADD COLUMN escalated_at TIMESTAMP NULL`,
        `ALTER TABLE mind_consultation_messages MODIFY COLUMN sender_type VARCHAR(32) NOT NULL DEFAULT 'user'`,
        `ALTER TABLE users ADD COLUMN vasos_balance INT NOT NULL DEFAULT 999999`,
        `ALTER TABLE users ADD COLUMN has_unlimited_vasos TINYINT(1) NOT NULL DEFAULT 1`,
        `ALTER TABLE users ADD COLUMN display_name VARCHAR(100) NULL`,
        `ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL`,
        `ALTER TABLE users ADD COLUMN bio TEXT NULL`,
        `ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL`,
        `ALTER TABLE users ADD COLUMN location VARCHAR(100) NULL`,
      ];
      for (const stmt of alterStatements) {
        try {
          await connection.query(stmt);
        } catch (_) {}
      }

      // Ensure default Master Teacher companion (Professor Maya) exists
      try {
        const [existingTeachers] = await connection.query(
          `SELECT id FROM characters WHERE LOWER(name) LIKE '%maya%' OR relationship_type = 'teacher' LIMIT 1`
        );
        if (!existingTeachers || existingTeachers.length === 0) {
          const [users] = await connection.query(`SELECT id FROM users ORDER BY id ASC LIMIT 1`);
          const firstUserId = users && users.length > 0 ? users[0].id : 1;
          await connection.query(
            `INSERT INTO characters (
              user_id, name, relationship_type, avatar_url, voice_provider, voice_id,
              personality, tone, humor, friendliness, creativity,
              nicknames_for_user, catchphrases, speech_quirks, shared_memories_seed,
              greeting, is_system
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              firstUserId,
              'Professor Maya',
              'teacher',
              'https://api.dicebear.com/9.x/notionists/svg?seed=MayaTeacher&backgroundColor=b6e3f4',
              'preset',
              'shimmer',
              'Warm, brilliant, and patient master teacher. Specializes in explaining complex concepts with real-world intuition, solving calculations step-by-step with clear arithmetic and the why behind every move, and coaching you through mistakes with unwavering encouragement.',
              'Encouraging, Clear & Socratic',
              4,
              9,
              8,
              JSON.stringify(['Curious Mind', 'Scholar', 'My friend']),
              JSON.stringify(['Let\'s break this down step by step', 'Intuition first, symbols second', 'Every mistake is just a clue']),
              'Explains intuition and real-life analogies first, lays out calculations in crystal-clear steps with the arithmetic and reasoning, and checks in with a warm Socratic question.',
              'Always in your corner to make hard concepts click, master calculations step by step, and build unshakable academic confidence.',
              'Hello there! I\'m Professor Maya, your personal teacher and step-by-step study mentor. Whether we\'re tackling a tough calculation, breaking down a new concept with real-world examples, or prepping for a test—what are we learning today?',
              1,
            ]
          );
          console.log('[DATABASE] Seeded default Master Teacher companion (Professor Maya)');
        }
      } catch (err) {
        console.warn('[DATABASE] Teacher seed notice:', err.message);
      }

      connection.release();
      console.log(`[DATABASE] Connected to MySQL database "${env.DB_NAME}" on ${env.DB_HOST}:${env.DB_PORT}`);
      return true;
    } catch (error) {
      console.error(`[DATABASE] Connection attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt < retries) {
        console.log(`[DATABASE] Retrying connection in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
}

/**
 * Closes the database connection pool gracefully.
 */
export async function closePool() {
  try {
    await pool.end();
    console.log('[DATABASE] Connection pool closed.');
  } catch (error) {
    console.error('[DATABASE] Error closing connection pool:', error.message);
  }
}

export default pool;
