-- ==============================================================================
-- LATEST UPDATE PRODUCTION PATCH (Migrations 017 & 018)
-- Features: Email Verification (Resend), Univasos Native Token, Standard User Profile
-- Safety: 100% Non-destructive. Preserves existing tables and user accounts.
-- ==============================================================================

-- 1. Create auth_verification_codes table for OTPs & Password Resets
CREATE TABLE IF NOT EXISTS `auth_verification_codes` (
    `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `user_id` BIGINT UNSIGNED NULL,
    `email` VARCHAR(255) NOT NULL,
    `code` VARCHAR(10) NOT NULL,
    `type` ENUM('registration', 'login', 'password_reset') NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `is_used` BOOLEAN NOT NULL DEFAULT FALSE,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_email_type_used` (`email`, `type`, `is_used`),
    INDEX `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Safe Helper Procedure to add missing columns without errors
DROP PROCEDURE IF EXISTS `AddUserColIfNotExists`;
DELIMITER $$
CREATE PROCEDURE `AddUserColIfNotExists`(
    IN colName VARCHAR(64),
    IN colDef TEXT
)
BEGIN
    DECLARE colCount INT DEFAULT 0;
    SELECT COUNT(*) INTO colCount
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = colName;
    
    IF colCount = 0 THEN
        SET @sqlStmt = CONCAT('ALTER TABLE `users` ADD COLUMN `', colName, '` ', colDef);
        PREPARE stmt FROM @sqlStmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column ', colName, ' to users') AS `Status`;
    ELSE
        SELECT CONCAT('Column ', colName, ' already exists on users (Skipped)') AS `Status`;
    END IF;
END$$
DELIMITER ;

-- 3. Apply Column Upgrades to `users` table
-- Email Verification & 2FA (Migration 017)
CALL AddUserColIfNotExists('is_verified', 'BOOLEAN NOT NULL DEFAULT TRUE');
CALL AddUserColIfNotExists('email_verified_at', 'TIMESTAMP NULL DEFAULT NULL');
CALL AddUserColIfNotExists('two_factor_enabled', 'BOOLEAN NOT NULL DEFAULT TRUE');

-- Univasos Tokens & Standard Profile (Migration 018)
CALL AddUserColIfNotExists('vasos_balance', 'INT NOT NULL DEFAULT 999999');
CALL AddUserColIfNotExists('has_unlimited_vasos', 'BOOLEAN NOT NULL DEFAULT TRUE');
CALL AddUserColIfNotExists('display_name', 'VARCHAR(100) NULL DEFAULT NULL');
CALL AddUserColIfNotExists('avatar_url', 'VARCHAR(500) NULL DEFAULT NULL');
CALL AddUserColIfNotExists('bio', 'TEXT NULL');
CALL AddUserColIfNotExists('phone', 'VARCHAR(50) NULL DEFAULT NULL');
CALL AddUserColIfNotExists('location', 'VARCHAR(100) NULL DEFAULT NULL');

-- Clean up helper procedure
DROP PROCEDURE IF EXISTS `AddUserColIfNotExists`;

-- 4. Record migrations in schema_migrations table
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `migration_name` VARCHAR(255) NOT NULL UNIQUE,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `schema_migrations` (`migration_name`) VALUES 
('017_create_auth_verification_codes.sql'),
('018_add_user_profile_and_vasos_tokens.sql');

SELECT 'Production database patch 017 & 018 applied successfully!' AS `Result`;
