-- Migration 019: Add per-character proactive auto-text & notification channel settings
ALTER TABLE characters
  ADD COLUMN proactive_frequency VARCHAR(32) NOT NULL DEFAULT '24h',
  ADD COLUMN proactive_preferred_time VARCHAR(32) NOT NULL DEFAULT 'anytime',
  ADD COLUMN proactive_channels JSON NULL;
