-- Migration 015: Add message editing and deletion support
ALTER TABLE messages
  ADD COLUMN is_edited BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN edited_at TIMESTAMP NULL;
