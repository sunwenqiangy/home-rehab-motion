CREATE TABLE `analysis_run` (
  `analysis_run_id` CHAR(36) NOT NULL,
  `video_id` BIGINT UNSIGNED NOT NULL,
  `provider_task_id` VARCHAR(64) NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'queued',
  `request_snapshot` JSON NULL,
  `algorithm_version` VARCHAR(64) NULL,
  `template_version` VARCHAR(64) NULL,
  `threshold_version` VARCHAR(64) NULL,
  `fail_reason` VARCHAR(255) NULL,
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`analysis_run_id`),
  INDEX `idx_analysis_run_video_created` (`video_id`, `created_at`),
  INDEX `idx_analysis_run_status` (`status`),
  CONSTRAINT `fk_analysis_run_video` FOREIGN KEY (`video_id`) REFERENCES `training_video` (`video_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `analysis_task`
  ADD COLUMN `analysis_run_id` CHAR(36) NULL,
  ADD INDEX `idx_analysis_task_run` (`analysis_run_id`),
  ADD CONSTRAINT `fk_analysis_task_run` FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_run` (`analysis_run_id`);

-- 仅约束启用内容；下线历史版本允许同动作多条并存。
ALTER TABLE `guidance_content`
  ADD COLUMN `active_action_type` VARCHAR(30)
    GENERATED ALWAYS AS (CASE WHEN `status` = 1 THEN `action_type` ELSE NULL END) STORED,
  ADD UNIQUE INDEX `uk_guidance_content_active_action` (`active_action_type`);
