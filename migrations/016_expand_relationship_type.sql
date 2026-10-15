-- 016_expand_relationship_type.sql
-- Expand relationship_type from ENUM to VARCHAR(64) to support teacher, tutor, educator, quant, sports, etc.
ALTER TABLE characters MODIFY COLUMN relationship_type VARCHAR(64) NOT NULL DEFAULT 'friend';
