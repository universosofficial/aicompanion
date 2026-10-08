-- Migration 013: High Concurrency Indexing
-- Optimizes query performance under heavy concurrent multi-user load.

ALTER TABLE mind_consultation_messages
  ADD INDEX idx_consult_messages_session_created (session_id, created_at);

ALTER TABLE mind_consultation_sessions
  ADD INDEX idx_consult_sessions_lookup (visitor_user_id, mind_id, last_message_at);

ALTER TABLE mind_sources
  ADD INDEX idx_mind_sources_mind_created (mind_id, created_at);

ALTER TABLE characters
  ADD INDEX idx_characters_user_created (user_id, created_at),
  ADD INDEX idx_characters_public_system (is_public, is_system);

ALTER TABLE conversations
  ADD INDEX idx_conv_user_updated (user_id, updated_at);
