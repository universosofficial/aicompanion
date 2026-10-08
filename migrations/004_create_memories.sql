-- Migration 004: Create memories table
CREATE TABLE IF NOT EXISTS memories (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    character_id BIGINT UNSIGNED NULL,
    category ENUM('preference', 'fact', 'relationship', 'goal', 'event') NOT NULL,
    content TEXT NOT NULL,
    importance_score TINYINT UNSIGNED NOT NULL DEFAULT 3,
    last_recalled_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_memories_user_category (user_id, category),
    INDEX idx_memories_user_character (user_id, character_id),
    CONSTRAINT fk_memories_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_memories_character_id FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
