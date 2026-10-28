-- Migration 018: Add profile metadata and Univasos token attributes to users
ALTER TABLE users
  ADD COLUMN vasos_balance INT NOT NULL DEFAULT 999999,
  ADD COLUMN has_unlimited_vasos BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN display_name VARCHAR(100) NULL,
  ADD COLUMN avatar_url VARCHAR(500) NULL,
  ADD COLUMN bio TEXT NULL,
  ADD COLUMN phone VARCHAR(50) NULL,
  ADD COLUMN location VARCHAR(100) NULL;
