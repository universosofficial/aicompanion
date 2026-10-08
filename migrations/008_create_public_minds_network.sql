-- Migration 008: Create Public Minds Network & Ingestion Engine

DROP PROCEDURE IF EXISTS upgrade_characters_for_minds_network;

CREATE PROCEDURE upgrade_characters_for_minds_network()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'is_public'
  ) THEN
    ALTER TABLE characters ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE AFTER is_system;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'is_verified'
  ) THEN
    ALTER TABLE characters ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE AFTER is_public;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'total_subscribers'
  ) THEN
    ALTER TABLE characters ADD COLUMN total_subscribers INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_public;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'handle'
  ) THEN
    ALTER TABLE characters ADD COLUMN handle VARCHAR(64) UNIQUE NULL AFTER name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'headline'
  ) THEN
    ALTER TABLE characters ADD COLUMN headline VARCHAR(255) NULL AFTER handle;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'website_url'
  ) THEN
    ALTER TABLE characters ADD COLUMN website_url VARCHAR(512) NULL AFTER avatar_url;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'philosophy_statement'
  ) THEN
    ALTER TABLE characters ADD COLUMN philosophy_statement MEDIUMTEXT NULL AFTER personality;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'decision_frameworks'
  ) THEN
    ALTER TABLE characters ADD COLUMN decision_frameworks JSON NULL AFTER interests;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND column_name = 'tags'
  ) THEN
    ALTER TABLE characters ADD COLUMN tags JSON NULL AFTER decision_frameworks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics 
    WHERE table_schema = DATABASE() AND table_name = 'characters' AND index_name = 'ft_mind_search'
  ) THEN
    ALTER TABLE characters ADD FULLTEXT INDEX ft_mind_search (name, headline, personality, philosophy_statement);
  END IF;
END;

CALL upgrade_characters_for_minds_network();
DROP PROCEDURE IF EXISTS upgrade_characters_for_minds_network;

-- 2. Media & Source Registry for Creator Ingestion
CREATE TABLE IF NOT EXISTS mind_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  source_type ENUM('url', 'pdf', 'document', 'manual_text') NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_uri VARCHAR(1024) NULL,
  status ENUM('pending', 'processing', 'indexed', 'failed') NOT NULL DEFAULT 'pending',
  chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  INDEX idx_source_character (character_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE mind_sources MODIFY COLUMN source_type ENUM('url', 'pdf', 'document', 'manual_text') NOT NULL;

-- 3. Chunked Knowledge Nodes for Fast Retrieval
CREATE TABLE IF NOT EXISTS mind_knowledge_nodes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  character_id BIGINT UNSIGNED NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  topic VARCHAR(100) NOT NULL DEFAULT 'general',
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES mind_sources(id) ON DELETE CASCADE,
  INDEX idx_mind_topic (character_id, topic),
  FULLTEXT INDEX ft_knowledge_content (title, content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. User Subscriptions / Added Minds
CREATE TABLE IF NOT EXISTS mind_subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_mind (user_id, character_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
