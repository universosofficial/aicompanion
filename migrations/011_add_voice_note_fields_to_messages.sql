-- Migration 011: Add voice note fields to messages and mind_consultation_messages
ALTER TABLE messages
  ADD COLUMN message_type ENUM('text', 'voice') NOT NULL DEFAULT 'text' AFTER sender_type,
  ADD COLUMN audio_url MEDIUMTEXT NULL AFTER content,
  ADD COLUMN duration_seconds INT UNSIGNED NULL AFTER audio_url;

ALTER TABLE mind_consultation_messages
  ADD COLUMN message_type ENUM('text', 'voice') NOT NULL DEFAULT 'text' AFTER sender_type,
  ADD COLUMN audio_url MEDIUMTEXT NULL AFTER content,
  ADD COLUMN duration_seconds INT UNSIGNED NULL AFTER audio_url;
