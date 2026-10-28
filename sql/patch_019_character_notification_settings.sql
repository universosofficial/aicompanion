-- ==============================================================================
-- PRODUCTION PATCH: Migration 019 (Character Notification & Auto-Text Settings)
-- Features: Per-character auto-text frequency, preferred time window, and notification channels (Push/Email)
-- Safety: 100% Non-destructive. Checks information_schema before adding columns.
-- ==============================================================================

DROP PROCEDURE IF EXISTS `AddCharColIfNotExists`;
DELIMITER $$
CREATE PROCEDURE `AddCharColIfNotExists`(
    IN colName VARCHAR(64),
    IN colDef TEXT
)
BEGIN
    DECLARE colCount INT DEFAULT 0;
    SELECT COUNT(*) INTO colCount
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'characters'
      AND COLUMN_NAME = colName;
    
    IF colCount = 0 THEN
        SET @sqlStmt = CONCAT('ALTER TABLE `characters` ADD COLUMN `', colName, '` ', colDef);
        PREPARE stmt FROM @sqlStmt;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column ', colName, ' to characters') AS `Status`;
    ELSE
        SELECT CONCAT('Column ', colName, ' already exists on characters (Skipped)') AS `Status`;
    END IF;
END$$
DELIMITER ;

-- Apply columns to characters table
CALL AddCharColIfNotExists('proactive_frequency', 'VARCHAR(32) NOT NULL DEFAULT \'24h\'');
CALL AddCharColIfNotExists('proactive_preferred_time', 'VARCHAR(32) NOT NULL DEFAULT \'anytime\'');
CALL AddCharColIfNotExists('proactive_channels', 'JSON NULL');

DROP PROCEDURE IF EXISTS `AddCharColIfNotExists`;

INSERT IGNORE INTO `schema_migrations` (`migration_name`) VALUES 
('019_add_character_notification_settings.sql');

SELECT 'Migration 019 patch applied successfully!' AS `Result`;
