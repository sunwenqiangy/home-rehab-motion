ALTER TABLE `guidance_content`
  MODIFY COLUMN `version` INT NOT NULL DEFAULT 0,
  ADD COLUMN `published_version` INT NULL AFTER `version`,
  ADD COLUMN `draft_snapshot` JSON NULL AFTER `published_version`;
