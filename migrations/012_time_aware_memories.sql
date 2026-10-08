-- Migration 012: Time-Aware Episodic Memory & Conversation Mapping
-- Binds memories to conversation sessions, exact chronological timestamps, calendar dates, and temporal anchors.

ALTER TABLE memories
  ADD COLUMN conversation_id BIGINT UNSIGNED NULL AFTER character_id,
  ADD COLUMN occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER importance_score,
  ADD COLUMN conversation_date DATE NULL AFTER occurred_at,
  ADD COLUMN temporal_anchor VARCHAR(128) NULL AFTER conversation_date;

-- Populate existing rows: occurred_at matches created_at, conversation_date matches DATE(created_at)
UPDATE memories
  SET occurred_at = created_at,
      conversation_date = DATE(created_at),
      temporal_anchor = 'historical_conversation'
  WHERE conversation_date IS NULL;

-- Backfill conversation_id for existing character memories where a conversation exists
UPDATE memories m
JOIN conversations c ON m.user_id = c.user_id AND m.character_id = c.character_id
SET m.conversation_id = c.id
WHERE m.conversation_id IS NULL AND m.character_id IS NOT NULL;

-- Add indexes for high-speed chronological recall and date-grouped retrieval
ALTER TABLE memories
  ADD INDEX idx_memories_conversation (conversation_id),
  ADD INDEX idx_memories_occurred (user_id, occurred_at),
  ADD INDEX idx_memories_conv_date (user_id, conversation_date);
