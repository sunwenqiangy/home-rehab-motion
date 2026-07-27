ALTER TABLE `analysis_task`
  ADD COLUMN `callback_status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  ADD COLUMN `callback_attempt_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN `callback_last_error` VARCHAR(255) NULL,
  ADD COLUMN `callback_next_retry_at` DATETIME NULL,
  ADD COLUMN `callback_payload` JSON NULL,
  ADD COLUMN `callback_url` VARCHAR(512) NULL;

CREATE INDEX `idx_analysis_task_callback_retry`
  ON `analysis_task` (`callback_status`, `callback_next_retry_at`);
