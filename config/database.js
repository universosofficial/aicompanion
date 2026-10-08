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
