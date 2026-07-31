ALTER TABLE `standard_action_template`
  MODIFY COLUMN `version` VARCHAR(64) NOT NULL,
  ADD COLUMN `version_type` VARCHAR(30) NOT NULL DEFAULT 'gold_template' AFTER `status`,
  ADD COLUMN `parent_template_id` BIGINT UNSIGNED NULL AFTER `version_type`,
  ADD COLUMN `change_summary` VARCHAR(500) NULL AFTER `parent_template_id`,
  ADD COLUMN `change_diff` JSON NULL AFTER `change_summary`,
  ADD COLUMN `ever_activated` TINYINT(1) NOT NULL DEFAULT 0 AFTER `change_diff`,
  ADD INDEX `idx_action_template_action_status` (`action_type`, `status`),
  ADD INDEX `idx_action_template_parent` (`parent_template_id`);

UPDATE `standard_action_template`
SET `ever_activated` = 1
WHERE `status` = 1;