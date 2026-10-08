-- Migration 010: Expand voice_sample_url to MEDIUMTEXT to allow base64 fallback or long CDN URLs safely
ALTER TABLE characters MODIFY COLUMN voice_sample_url MEDIUMTEXT NULL;
ALTER TABLE user_minds MODIFY COLUMN voice_sample_url MEDIUMTEXT NULL;
