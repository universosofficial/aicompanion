-- ==============================================================================
-- AI COMPANION / LUMINA - SAFE PRODUCTION WORKBENCH UPDATE SCRIPT
-- ==============================================================================
-- Purpose: Safely update existing Railway production database in MySQL Workbench
-- Safety:  100% NON-DESTRUCTIVE.
--          Contains ZERO 'DROP TABLE' and ZERO 'TRUNCATE'.
--          Safe to run multiple times (Idempotent). Existing data is PRESERVED.
-- ==============================================================================

-- 0. Select active database
-- In MySQL Workbench, double-click your database schema in the left sidebar
-- (e.g. `railway`), or uncomment the line below:
-- USE `railway`;

-- 1. Ensure schema_migrations table exists
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `migration_name` VARCHAR(255) NOT NULL UNIQUE,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Helper Procedures for Safe Column and Index Additions
DROP PROCEDURE IF EXISTS `AddColumnIfNotExists`;
DROP PROCEDURE IF EXISTS `AddIndexIfNotExists`;

DELIMITER $$
CREATE PROCEDURE `AddColumnIfNotExists`(
    IN targetTable VARCHAR(64),
    IN targetColumn VARCHAR(64),
    IN columnDefinition TEXT
)
BEGIN
    DECLARE colCount INT DEFAULT 0;
    SELECT COUNT(*) INTO colCount
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = targetTable
      AND COLUMN_NAME = targetColumn;
    
    IF colCount = 0 THEN
        SET @sqlStmt = CONCAT('ALTER TABLE `', targetTable, '` ADD COLUMN `', targetColumn, '` ', columnDefinition);
        PREPARE stmt FROM @sqlStmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column ', targetColumn, ' to ', targetTable) AS `Migration Status`;
    ELSE
        SELECT CONCAT('Column ', targetColumn, ' already exists on ', targetTable, ' (Skipped)') AS `Migration Status`;
    END IF;
END$$

CREATE PROCEDURE `AddIndexIfNotExists`(
    IN targetTable VARCHAR(64),
    IN targetIndex VARCHAR(64),
    IN indexColumns VARCHAR(255)
)
BEGIN
    DECLARE idxCount INT DEFAULT 0;
    SELECT COUNT(*) INTO idxCount
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = targetTable
      AND INDEX_NAME = targetIndex;
    
    IF idxCount = 0 THEN
        SET @sqlStmt = CONCAT('ALTER TABLE `', targetTable, '` ADD INDEX `', targetIndex, '` (', indexColumns, ')');
        PREPARE stmt FROM @sqlStmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added index ', targetIndex, ' to ', targetTable) AS `Migration Status`;
    ELSE
        SELECT CONCAT('Index ', targetIndex, ' already exists on ', targetTable, ' (Skipped)') AS `Migration Status`;
    END IF;
END$$
DELIMITER ;

-- ==============================================================================
-- 3. Core Tables (Created only if missing; untouched if already present)
-- ==============================================================================

-- A. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `first_name` VARCHAR(100) DEFAULT NULL,
  `last_name` VARCHAR(100) DEFAULT NULL,
  `refresh_token` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- B. Characters Table
CREATE TABLE IF NOT EXISTS `characters` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `relationship_type` VARCHAR(64) NOT NULL DEFAULT 'friend',
  `avatar_url` VARCHAR(512) DEFAULT NULL,
  `gender` VARCHAR(50) DEFAULT NULL,
  `personality` TEXT NOT NULL,
  `tone` VARCHAR(100) NOT NULL,
  `humor` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `friendliness` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `creativity` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `style` VARCHAR(100) NOT NULL DEFAULT 'Casual & Warm',
  `backstory` TEXT DEFAULT NULL,
  `interests` JSON DEFAULT NULL,
  `greeting` TEXT NOT NULL,
  `is_system` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_characters_user_id` (`user_id`),
  CONSTRAINT `fk_characters_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- C. Conversations Table
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `character_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) DEFAULT NULL,
  `last_message_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_conversations_user_id` (`user_id`),
  INDEX `idx_conversations_character_id` (`character_id`),
  CONSTRAINT `fk_conversations_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_conversations_character_id` FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D. Messages Table
CREATE TABLE IF NOT EXISTS `messages` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `sender_type` ENUM('user', 'assistant') NOT NULL,
  `content` TEXT NOT NULL,
  `token_count` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_messages_conversation_id` (`conversation_id`),
  CONSTRAINT `fk_messages_conversation_id` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- E. Memories Table
CREATE TABLE IF NOT EXISTS `memories` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `character_id` BIGINT UNSIGNED NOT NULL,
  `content` TEXT NOT NULL,
  `importance_score` TINYINT UNSIGNED NOT NULL DEFAULT 5,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_memories_user_character` (`user_id`, `character_id`),
  CONSTRAINT `fk_memories_user_id` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_memories_character_id` FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F. User Minds (1:1 Sovereign AI Minds)
CREATE TABLE IF NOT EXISTS `user_minds` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL UNIQUE,
  `handle` VARCHAR(64) UNIQUE NOT NULL,
  `display_name` VARCHAR(100) NOT NULL,
  `headline` VARCHAR(255) NULL,
  `avatar_url` VARCHAR(512) NULL,
  `website_url` VARCHAR(512) NULL,
  `bio` TEXT NULL,
  `philosophy_statement` MEDIUMTEXT NULL,
  `decision_frameworks` JSON NULL,
  `tags` JSON NULL,
  `is_published` BOOLEAN NOT NULL DEFAULT FALSE,
  `total_consultations` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- G. Mind Knowledge Sources
CREATE TABLE IF NOT EXISTS `mind_sources` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `mind_id` BIGINT UNSIGNED NOT NULL,
  `source_type` ENUM('url', 'pdf', 'document', 'manual_text') NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `source_uri` VARCHAR(1024) NULL,
  `status` ENUM('pending', 'processing', 'indexed', 'failed') NOT NULL DEFAULT 'pending',
  `chunk_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`mind_id`) REFERENCES `user_minds`(`id`) ON DELETE CASCADE,
  INDEX `idx_mind_source` (`mind_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- H. Mind Knowledge Nodes
CREATE TABLE IF NOT EXISTS `mind_knowledge_nodes` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `mind_id` BIGINT UNSIGNED NOT NULL,
  `source_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(255) NOT NULL,
  `topic` VARCHAR(100) NOT NULL DEFAULT 'general',
  `content` MEDIUMTEXT NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`mind_id`) REFERENCES `user_minds`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_id`) REFERENCES `mind_sources`(`id`) ON DELETE CASCADE,
  INDEX `idx_mind_knowledge` (`mind_id`, `topic`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- I. Mind Consultation Sessions & Messages
CREATE TABLE IF NOT EXISTS `mind_consultation_sessions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `visitor_user_id` BIGINT UNSIGNED NOT NULL,
  `mind_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NULL,
  `last_message_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`visitor_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`mind_id`) REFERENCES `user_minds`(`id`) ON DELETE CASCADE,
  INDEX `idx_visitor_mind` (`visitor_user_id`, `mind_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mind_consultation_messages` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `sender_type` VARCHAR(32) NOT NULL DEFAULT 'user',
  `content` MEDIUMTEXT NOT NULL,
  `grounding_nodes` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`session_id`) REFERENCES `mind_consultation_sessions`(`id`) ON DELETE CASCADE,
  INDEX `idx_consultation_session` (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- J. Mind Subscriptions
CREATE TABLE IF NOT EXISTS `mind_subscriptions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `mind_id` BIGINT UNSIGNED NULL,
  `character_id` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_sub_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 4. Safe Non-Destructive Column Upgrades on Existing Tables
-- ==============================================================================

-- A. Messages table upgrades (Editing, deletion, voice notes)
CALL AddColumnIfNotExists('messages', 'is_edited', 'BOOLEAN NOT NULL DEFAULT FALSE');
CALL AddColumnIfNotExists('messages', 'edited_at', 'TIMESTAMP NULL DEFAULT NULL');
CALL AddColumnIfNotExists('messages', 'deleted_at', 'TIMESTAMP NULL DEFAULT NULL');
CALL AddColumnIfNotExists('messages', 'voice_note_url', 'VARCHAR(512) NULL DEFAULT NULL');
CALL AddColumnIfNotExists('messages', 'voice_duration_seconds', 'DECIMAL(6,2) NULL DEFAULT NULL');
CALL AddColumnIfNotExists('messages', 'voice_transcript', 'TEXT NULL');
CALL AddColumnIfNotExists('messages', 'audio_status', 'ENUM(\'none\', \'generating\', \'ready\', \'failed\') NOT NULL DEFAULT \'none\'');

-- B. Characters table upgrades (Sports quant, custom roles, speech quirks)
ALTER TABLE `characters` MODIFY COLUMN `relationship_type` VARCHAR(64) NOT NULL DEFAULT 'friend';
CALL AddColumnIfNotExists('characters', 'is_public', 'BOOLEAN NOT NULL DEFAULT FALSE');
CALL AddColumnIfNotExists('characters', 'is_sports_analyst', 'BOOLEAN NOT NULL DEFAULT FALSE');
CALL AddColumnIfNotExists('characters', 'analysis_style', 'VARCHAR(64) NOT NULL DEFAULT \'quant_expected_value\'');
CALL AddColumnIfNotExists('characters', 'primary_leagues', 'JSON NULL');
CALL AddColumnIfNotExists('characters', 'risk_tier', 'VARCHAR(64) NOT NULL DEFAULT \'balanced_quarter_kelly\'');
CALL AddColumnIfNotExists('characters', 'allow_proactive_checkins', 'BOOLEAN NOT NULL DEFAULT TRUE');
CALL AddColumnIfNotExists('characters', 'voice_provider', 'VARCHAR(50) NOT NULL DEFAULT \'preset\'');
CALL AddColumnIfNotExists('characters', 'voice_id', 'VARCHAR(100) NOT NULL DEFAULT \'alloy\'');
CALL AddColumnIfNotExists('characters', 'voice_sample_url', 'VARCHAR(1024) NULL DEFAULT NULL');
CALL AddColumnIfNotExists('characters', 'voice_settings', 'JSON NULL');
CALL AddColumnIfNotExists('characters', 'nicknames_for_user', 'JSON NULL');
CALL AddColumnIfNotExists('characters', 'catchphrases', 'JSON NULL');
CALL AddColumnIfNotExists('characters', 'speech_quirks', 'TEXT NULL');
CALL AddColumnIfNotExists('characters', 'shared_memories_seed', 'TEXT NULL');

-- C. User Minds & Direct Paid Human Chat upgrades
CALL AddColumnIfNotExists('user_minds', 'direct_chat_enabled', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL AddColumnIfNotExists('user_minds', 'direct_chat_price', 'DECIMAL(10,2) NOT NULL DEFAULT 25.00');
CALL AddColumnIfNotExists('user_minds', 'direct_chat_sla', 'VARCHAR(140) NOT NULL DEFAULT \'Replies personally within a few hours\'');

CALL AddColumnIfNotExists('mind_consultation_sessions', 'chat_mode', 'VARCHAR(32) NOT NULL DEFAULT \'ai\'');
CALL AddColumnIfNotExists('mind_consultation_sessions', 'is_paid_unlocked', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL AddColumnIfNotExists('mind_consultation_sessions', 'paid_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
CALL AddColumnIfNotExists('mind_consultation_sessions', 'handoff_summary', 'TEXT NULL');
CALL AddColumnIfNotExists('mind_consultation_sessions', 'escalation_note', 'TEXT NULL');
CALL AddColumnIfNotExists('mind_consultation_sessions', 'unread_for_creator', 'INT NOT NULL DEFAULT 0');
CALL AddColumnIfNotExists('mind_consultation_sessions', 'escalated_at', 'TIMESTAMP NULL');

-- ==============================================================================
-- 5. Create Advanced Engine Tables (Push, Threads, Bankroll, Sports Ledger)
-- ==============================================================================

-- A. Web Push Subscriptions (VAPID)
CREATE TABLE IF NOT EXISTS `user_push_subscriptions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX `idx_user_sub` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- B. Contextual Seeds & Open Memory Threads
CREATE TABLE IF NOT EXISTS `character_open_threads` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `character_id` BIGINT UNSIGNED NOT NULL,
  `topic_summary` VARCHAR(255) NOT NULL,
  `trigger_after` TIMESTAMP NOT NULL,
  `is_resolved` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE,
  INDEX `idx_pending_threads` (`trigger_after`, `is_resolved`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- C. Proactive Outreach Telemetry
CREATE TABLE IF NOT EXISTS `proactive_dispatch_log` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `character_id` BIGINT UNSIGNED NOT NULL,
  `message_id` BIGINT UNSIGNED NULL,
  `dispatch_reason` VARCHAR(64) NOT NULL,
  `dispatched_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE,
  INDEX `idx_user_dispatch_window` (`user_id`, `character_id`, `dispatched_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D. Sports Betting Bankroll Settings
CREATE TABLE IF NOT EXISTS `user_bankroll_settings` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL UNIQUE,
  `total_bankroll` DECIMAL(12, 2) NOT NULL DEFAULT 1000.00,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'USD',
  `staking_model` ENUM('quarter_kelly', 'eighth_kelly', 'fixed_unit') NOT NULL DEFAULT 'quarter_kelly',
  `max_unit_limit_percent` DECIMAL(4, 2) NOT NULL DEFAULT 2.50,
  `daily_stop_loss_percent` DECIMAL(4, 2) NOT NULL DEFAULT 5.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- E. Sports Odds Cache
CREATE TABLE IF NOT EXISTS `sports_market_cache` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `cache_key` VARCHAR(128) UNIQUE NOT NULL,
  `fixture_name` VARCHAR(128) NOT NULL,
  `payload` JSON NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_cache_lookup` (`cache_key`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- F. Bet Recommendation Ledger
CREATE TABLE IF NOT EXISTS `bet_recommendation_ledger` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `character_id` BIGINT UNSIGNED NOT NULL,
  `fixture_name` VARCHAR(128) NOT NULL,
  `market_type` VARCHAR(64) NOT NULL,
  `recommended_selection` VARCHAR(64) NOT NULL,
  `model_win_prob` DECIMAL(5, 2) NOT NULL,
  `entry_odds` DECIMAL(6, 3) NOT NULL,
  `closing_odds` DECIMAL(6, 3) NULL,
  `model_ev_percent` DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
  `recommended_stake_units` DECIMAL(5, 2) NOT NULL,
  `recommended_stake_amount` DECIMAL(10, 2) NOT NULL,
  `actual_stake_amount` DECIMAL(10, 2) NULL,
  `settled_result` ENUM('pending', 'won', 'lost', 'push', 'void') NOT NULL DEFAULT 'pending',
  `actual_pnl` DECIMAL(10, 2) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE,
  INDEX `idx_user_ledger` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- G. Sports Tilt & Streak Telemetry
CREATE TABLE IF NOT EXISTS `user_streak_telemetry` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL UNIQUE,
  `consecutive_losses` INT NOT NULL DEFAULT 0,
  `daily_pnl` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `circuit_breaker_active` BOOLEAN NOT NULL DEFAULT FALSE,
  `lockout_until` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- H. Voice Profiles Table
CREATE TABLE IF NOT EXISTS `voice_profiles` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `provider` ENUM('preset', 'custom', 'elevenlabs') NOT NULL DEFAULT 'preset',
  `voice_id` VARCHAR(100) NOT NULL,
  `sample_url` VARCHAR(1024) NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- I. Time-Aware Memories Table
CREATE TABLE IF NOT EXISTS `time_aware_memories` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `character_id` BIGINT UNSIGNED NOT NULL,
  `memory_fact` TEXT NOT NULL,
  `time_anchor` ENUM('today', 'yesterday', 'past_event', 'future_goal', 'routine') NOT NULL DEFAULT 'today',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- 6. High Concurrency Indexes (Added safely if missing)
-- ==============================================================================
CALL AddIndexIfNotExists('mind_consultation_messages', 'idx_consult_messages_session_created', 'session_id, created_at');
CALL AddIndexIfNotExists('mind_consultation_sessions', 'idx_consult_sessions_lookup', 'visitor_user_id, mind_id, last_message_at');
CALL AddIndexIfNotExists('mind_sources', 'idx_mind_sources_mind_created', 'mind_id, created_at');
CALL AddIndexIfNotExists('characters', 'idx_characters_user_created', 'user_id, created_at');
CALL AddIndexIfNotExists('characters', 'idx_characters_public_system', 'is_public, is_system');
CALL AddIndexIfNotExists('conversations', 'idx_conv_user_updated', 'user_id, updated_at');

-- Clean up helper procedures
DROP PROCEDURE IF EXISTS `AddColumnIfNotExists`;
DROP PROCEDURE IF EXISTS `AddIndexIfNotExists`;

-- ==============================================================================
-- 7. Mark Migrations as Applied in Tracking Table
-- ==============================================================================
INSERT IGNORE INTO `schema_migrations` (`migration_name`) VALUES 
('001_create_users.sql'),
('002_create_characters.sql'),
('003_create_conversations_and_messages.sql'),
('004_create_memories.sql'),
('005_create_summaries.sql'),
('006_create_usage_logs.sql'),
('007_relational_persona_upgrade.sql'),
('008_create_public_minds_network.sql'),
('008_separate_user_minds_and_characters.sql'),
('009_create_voice_profiles.sql'),
('010_expand_voice_sample_url.sql'),
('011_add_voice_note_fields_to_messages.sql'),
('012_time_aware_memories.sql'),
('013_create_proactive_engine.sql'),
('013_high_concurrency_indexes.sql'),
('014_create_sports_betting_engine.sql'),
('015_add_message_edit_and_delete.sql'),
('016_expand_relationship_type.sql');

SELECT 'Railway production database successfully synchronized with 0 data loss!' AS `Result`;
