import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import env from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log('====================================================');
  console.log('         AI COMPANION - MIGRATION RUNNER            ');
  console.log('====================================================');
  console.log(`Target: ${env.DATABASE_URL ? '[DATABASE_URL provided]' : `${env.DB_HOST}:${env.DB_PORT} / Database: "${env.DB_NAME}"`}`);

  let adminConnection;
  let connection;

  const sslOption = env.DB_SSL ? { rejectUnauthorized: false } : undefined;

  try {
    // 1. Ensure the database exists (attempted on local/self-hosted; gracefully skipped if managed cloud DB)
    if (!env.DATABASE_URL) {
      try {
        adminConnection = await mysql.createConnection({
          host: env.DB_HOST,
          port: env.DB_PORT,
          user: env.DB_USER,
          password: env.DB_PASSWORD,
          ssl: sslOption,
        });

        await adminConnection.query(
          `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
        );
        await adminConnection.end();
        adminConnection = null;
      } catch (adminErr) {
        console.warn(`[MIGRATION RUNNER] Notice: Skipping root CREATE DATABASE (${adminErr.message}). Assuming target database exists.`);
        if (adminConnection) {
          try { await adminConnection.end(); } catch (_) {}
          adminConnection = null;
        }
      }
    }

    // 2. Connect to the target database with multipleStatements enabled
    const connConfig = env.DATABASE_URL
      ? {
          uri: env.DATABASE_URL,
          multipleStatements: true,
          ...(sslOption ? { ssl: sslOption } : {}),
        }
      : {
          host: env.DB_HOST,
          port: env.DB_PORT,
          user: env.DB_USER,
          password: env.DB_PASSWORD,
          database: env.DB_NAME,
          multipleStatements: true,
          ...(sslOption ? { ssl: sslOption } : {}),
        };

    connection = await mysql.createConnection(connConfig);

    // 3. Create schema_migrations tracking table if not present
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Retrieve list of already applied migrations
    const [appliedRows] = await connection.query('SELECT migration_name FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

    // 5. Discover .sql files in the migrations directory
    const files = fs
      .readdirSync(__dirname)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const pendingFiles = files.filter((file) => !appliedSet.has(file));

    if (pendingFiles.length === 0) {
      console.log('[MIGRATION] Database is up to date. No pending migrations.');
      return;
    }

    console.log(`[MIGRATION] Found ${pendingFiles.length} pending migration(s)...`);

    // 6. Execute pending migrations sequentially
    for (const file of pendingFiles) {
      const filePath = path.join(__dirname, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      console.log(`[MIGRATION] Applying: ${file}...`);
      const startTime = Date.now();

      // Execute migration script
      await connection.query(sqlContent);

      // Record migration in tracking table
      await connection.execute(
        'INSERT INTO schema_migrations (migration_name) VALUES (?)',
        [file]
      );

      const elapsed = Date.now() - startTime;
      console.log(`[MIGRATION] Completed: ${file} (${elapsed}ms)`);
    }

    console.log('====================================================');
    console.log('[MIGRATION] All migrations applied successfully!');
    console.log('====================================================');
  } catch (error) {
    console.error('[MIGRATION ERROR] Failed to run migrations:');
    console.error(error.message);
    if (error.code) console.error(`Error Code: ${error.code}`);
    if (error.sql) console.error(`Failed SQL:\n${error.sql}`);
    process.exit(1);
  } finally {
    if (adminConnection) {
      try { await adminConnection.end(); } catch (_) {}
    }
    if (connection) {
      try { await connection.end(); } catch (_) {}
    }
  }
}

runMigrations();
