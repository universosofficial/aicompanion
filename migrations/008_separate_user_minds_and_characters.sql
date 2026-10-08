-- Migration: Separate User Minds (1:1 Digital Twin) and Characters (1:N Private Companions)

-- Re-align mind_knowledge_nodes and mind_sources if they existed with character_id
DROP TABLE IF EXISTS mind_consultation_messages;
DROP TABLE IF EXISTS mind_consultation_sessions;
DROP TABLE IF EXISTS mind_knowledge_nodes;
DROP TABLE IF EXISTS mind_sources;

-- 1. Create dedicated user_minds table (Strict 1:1 relationship with users)
CREATE TABLE IF NOT EXISTS user_minds (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  handle VARCHAR(64) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  headline VARCHAR(255) NULL,
  avatar_url VARCHAR(512) NULL,
  website_url VARCHAR(512) NULL,
  bio TEXT NULL,
  philosophy_statement MEDIUMTEXT NULL,
  decision_frameworks JSON NULL,
  tags JSON NULL,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  total_consultations INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FULLTEXT INDEX ft_user_minds (display_name, handle, headline, philosophy_statement)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Knowledge sources table tied directly to the user's mind
CREATE TABLE IF NOT EXISTS mind_sources (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mind_id BIGINT UNSIGNED NOT NULL,
  source_type ENUM('url', 'pdf', 'document', 'manual_text') NOT NULL,
  title VARCHAR(255) NOT NULL,
  source_uri VARCHAR(1024) NULL,
  status ENUM('pending', 'processing', 'indexed', 'failed') NOT NULL DEFAULT 'pending',
  chunk_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mind_id) REFERENCES user_minds(id) ON DELETE CASCADE,
  INDEX idx_mind_source (mind_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Ingested knowledge chunks for fast retrieval
CREATE TABLE IF NOT EXISTS mind_knowledge_nodes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mind_id BIGINT UNSIGNED NOT NULL,
  source_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  topic VARCHAR(100) NOT NULL DEFAULT 'general',
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (mind_id) REFERENCES user_minds(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES mind_sources(id) ON DELETE CASCADE,
  INDEX idx_mind_knowledge (mind_id, topic),
  FULLTEXT INDEX ft_mind_knowledge_content (title, content)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Isolated private visitor consultations with public minds
CREATE TABLE IF NOT EXISTS mind_consultation_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_user_id BIGINT UNSIGNED NOT NULL,
  mind_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Consultation',
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (visitor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (mind_id) REFERENCES user_minds(id) ON DELETE CASCADE,
  INDEX idx_visitor_sessions (visitor_user_id, mind_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mind_consultation_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  sender_type ENUM('user', 'mind') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES mind_consultation_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
