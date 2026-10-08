-- Migration 009: Voice Profiles, Cloned Audio Assets & Generation Telemetry

-- 1. Add voice configuration to characters (Private Companions)
ALTER TABLE characters
  ADD COLUMN voice_provider ENUM('preset', 'cloned', 'none') NOT NULL DEFAULT 'preset' AFTER avatar_url,
  ADD COLUMN voice_id VARCHAR(128) NULL AFTER voice_provider,
  ADD COLUMN voice_sample_url VARCHAR(512) NULL AFTER voice_id,
  ADD COLUMN voice_settings JSON NULL AFTER voice_sample_url;

-- 2. Add voice configuration to user_minds (1:1 Public Digital Twin)
ALTER TABLE user_minds
  ADD COLUMN voice_provider ENUM('preset', 'cloned', 'none') NOT NULL DEFAULT 'preset' AFTER avatar_url,
  ADD COLUMN voice_id VARCHAR(128) NULL AFTER voice_provider,
  ADD COLUMN voice_sample_url VARCHAR(512) NULL AFTER voice_id,
  ADD COLUMN voice_settings JSON NULL AFTER voice_sample_url;

-- 3. Audio asset storage and voice generation logs
CREATE TABLE IF NOT EXISTS voice_audio_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NULL,
  conversation_id BIGINT UNSIGNED NULL,
  direction ENUM('user_mic_stt', 'ai_speech_tts') NOT NULL,
  audio_duration_seconds DECIMAL(6, 2) NULL,
  characters_billed INT UNSIGNED DEFAULT 0,
  latency_ms INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_voice_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
