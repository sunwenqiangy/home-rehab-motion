ALTER TABLE `training_video`
  ADD COLUMN `confirmed_at` DATETIME(3) NULL;

CREATE TABLE `training_attendance` (
  `attendance_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `video_id` BIGINT UNSIGNED NOT NULL,
  `training_date` DATE NOT NULL,
  `counted_for_training_day` BOOLEAN NOT NULL DEFAULT false,
  `counted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `training_attendance_video_id_key`(`video_id`),
  INDEX `idx_training_attendance_user_date`(`user_id`, `training_date`),
  PRIMARY KEY (`attendance_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `training_motivation_snapshot` (
  `snapshot_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `video_id` BIGINT UNSIGNED NOT NULL,
  `training_count_after` INTEGER NOT NULL,
  `training_days_after` INTEGER NOT NULL,
  `consecutive_training_days_after` INTEGER NOT NULL,
  `weekly_training_days_after` INTEGER NOT NULL,
  `qualified_count_after` INTEGER NOT NULL,
  `improvement_level` VARCHAR(20) NOT NULL DEFAULT 'none',
  `improvement_type` VARCHAR(20) NULL,
  `improvement_message` VARCHAR(255) NOT NULL,
  `newly_unlocked_badge_codes` JSON NULL,
  `stage` VARCHAR(30) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `training_motivation_snapshot_video_id_key`(`video_id`),
  INDEX `idx_motivation_snapshot_user_created`(`user_id`, `created_at`),
  PRIMARY KEY (`snapshot_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_badge`
  ADD COLUMN `source_video_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `notified_at` DATETIME(3) NULL,
  ADD COLUMN `seen_at` DATETIME(3) NULL;

ALTER TABLE `notification`
  ADD COLUMN `dedupe_key` VARCHAR(120) NULL,
  ADD UNIQUE INDEX `notification_dedupe_key_key`(`dedupe_key`);

ALTER TABLE `training_attendance`
  ADD CONSTRAINT `training_attendance_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `training_attendance_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `training_motivation_snapshot`
  ADD CONSTRAINT `training_motivation_snapshot_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `training_motivation_snapshot_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `user_badge`
  ADD CONSTRAINT `user_badge_source_video_id_fkey` FOREIGN KEY (`source_video_id`) REFERENCES `training_video`(`video_id`) ON DELETE SET NULL ON UPDATE CASCADE;
