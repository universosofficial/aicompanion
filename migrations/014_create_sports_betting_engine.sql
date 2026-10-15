-- Migration 014: Quantitative Sports Betting Intelligence & Risk Management Engine

-- 1. Extend characters table with sports analyst configuration
ALTER TABLE characters
  ADD COLUMN is_sports_analyst BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN analysis_style ENUM('quant_expected_value', 'tactical_pundit', 'conservative_grinder') NOT NULL DEFAULT 'quant_expected_value',
  ADD COLUMN primary_leagues JSON NULL,
  ADD COLUMN risk_tier ENUM('conservative_eighth_kelly', 'balanced_quarter_kelly', 'fixed_one_percent') NOT NULL DEFAULT 'balanced_quarter_kelly';

-- 2. User bankroll settings
CREATE TABLE IF NOT EXISTS user_bankroll_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  total_bankroll DECIMAL(12, 2) NOT NULL DEFAULT 1000.00,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  staking_model ENUM('quarter_kelly', 'eighth_kelly', 'fixed_unit') NOT NULL DEFAULT 'quarter_kelly',
  max_unit_limit_percent DECIMAL(4, 2) NOT NULL DEFAULT 2.50,
  daily_stop_loss_percent DECIMAL(4, 2) NOT NULL DEFAULT 5.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Cache table for free API rate-limit conservation
CREATE TABLE IF NOT EXISTS sports_market_cache (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cache_key VARCHAR(128) UNIQUE NOT NULL,
  fixture_name VARCHAR(128) NOT NULL,
  payload JSON NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cache_lookup (cache_key, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Closing Line Value (CLV) & Performance Tracking Ledger
CREATE TABLE IF NOT EXISTS bet_recommendation_ledger (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  character_id BIGINT UNSIGNED NOT NULL,
  fixture_name VARCHAR(128) NOT NULL,
  market_type VARCHAR(64) NOT NULL,
  recommended_selection VARCHAR(64) NOT NULL,
  model_win_prob DECIMAL(5, 2) NOT NULL,
  entry_odds DECIMAL(6, 3) NOT NULL,
  closing_odds DECIMAL(6, 3) NULL,
  recommended_stake_units DECIMAL(5, 2) NOT NULL,
  recommended_stake_amount DECIMAL(10, 2) NOT NULL,
  clv_percent DECIMAL(6, 2) NULL,
  bet_status ENUM('pending', 'won', 'lost', 'void', 'pushed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE,
  INDEX idx_user_ledger (user_id, bet_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. User loss streak & tilt telemetry
CREATE TABLE IF NOT EXISTS user_streak_telemetry (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  consecutive_losses INT UNSIGNED NOT NULL DEFAULT 0,
  daily_pnl DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  circuit_breaker_active BOOLEAN NOT NULL DEFAULT FALSE,
  lockout_until TIMESTAMP NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
