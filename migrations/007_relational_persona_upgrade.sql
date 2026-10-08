-- Migration 007: Relational Persona & Emotional Memory Upgrade

-- 1. Add relational persona fields to characters table
ALTER TABLE characters 
  ADD COLUMN relationship_type ENUM('father', 'mother', 'spouse', 'partner', 'friend', 'mentor', 'sibling', 'custom') NOT NULL DEFAULT 'friend' AFTER name,
  ADD COLUMN nicknames_for_user JSON DEFAULT NULL AFTER style,
  ADD COLUMN catchphrases JSON DEFAULT NULL AFTER nicknames_for_user,
  ADD COLUMN speech_quirks TEXT DEFAULT NULL AFTER catchphrases,
  ADD COLUMN shared_memories_seed MEDIUMTEXT DEFAULT NULL AFTER speech_quirks;

-- 2. Enhance memories table to distinguish persona anchors from user facts
ALTER TABLE memories
  ADD COLUMN memory_type ENUM('persona_anchor', 'user_fact', 'shared_event', 'emotional_state') NOT NULL DEFAULT 'user_fact' AFTER character_id,
  ADD INDEX idx_memories_type (character_id, memory_type);
