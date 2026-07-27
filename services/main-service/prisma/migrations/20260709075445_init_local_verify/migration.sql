-- CreateTable
CREATE TABLE `user_profile` (
    `user_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `openid` VARCHAR(64) NOT NULL,
    `name` VARCHAR(50) NULL,
    `gender` INTEGER NULL,
    `age` INTEGER NULL,
    `phone` VARCHAR(20) NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'patient',
    `status` INTEGER NOT NULL DEFAULT 1,
    `display_mode` VARCHAR(20) NOT NULL DEFAULT 'elderly',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_profile_openid_key`(`openid`),
    INDEX `idx_user_role`(`role`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_account` (
    `account_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(50) NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'admin',
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_account_username_key`(`username`),
    PRIMARY KEY (`account_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guidance_content` (
    `content_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `action_type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `brief_instruction` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `video_key` VARCHAR(255) NULL,
    `video_url` VARCHAR(512) NULL,
    `thumbnail_url` VARCHAR(512) NULL,
    `text_instruction` TEXT NULL,
    `common_mistakes` TEXT NULL,
    `shooting_requirement` TEXT NULL,
    `step_images` JSON NULL,
    `shooting_guide_images` JSON NULL,
    `common_mistake_images` JSON NULL,
    `status` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by` BIGINT UNSIGNED NULL,
    `updated_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_guidance_action_type`(`action_type`),
    PRIMARY KEY (`content_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guidance_content_version` (
    `version_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `content_id` BIGINT UNSIGNED NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot` JSON NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_guidance_content_version`(`content_id`, `version`),
    PRIMARY KEY (`version_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_video` (
    `video_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `action_type` VARCHAR(30) NOT NULL,
    `source_type` VARCHAR(20) NULL,
    `video_key` VARCHAR(255) NULL,
    `video_key_720p` VARCHAR(255) NULL,
    `duration` DOUBLE NULL,
    `resolution` VARCHAR(20) NULL,
    `upload_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `analysis_status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `quality_status` VARCHAR(20) NULL,
    `quality_score` DOUBLE NULL,
    `quality_issues` JSON NULL,
    `fail_reason` VARCHAR(255) NULL,
    `model_version` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_training_video_user_id`(`user_id`),
    INDEX `idx_training_video_analysis_status`(`analysis_status`),
    PRIMARY KEY (`video_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analysis_task` (
    `task_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `video_id` BIGINT UNSIGNED NOT NULL,
    `provider_task_id` VARCHAR(64) NULL,
    `task_status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `fail_reason` VARCHAR(255) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `analysis_task_video_id_key`(`video_id`),
    PRIMARY KEY (`task_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `standard_action_template` (
    `template_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `action_type` VARCHAR(30) NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `description` TEXT NULL,
    `reference_stats` JSON NULL,
    `threshold_config` JSON NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_by` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uk_action_template_type_version`(`action_type`, `version`),
    PRIMARY KEY (`template_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `motion_feature_result` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `video_id` BIGINT UNSIGNED NOT NULL,
    `rep_id` INTEGER NULL,
    `feature_code` VARCHAR(50) NOT NULL,
    `feature_value` DOUBLE NULL,
    `unit` VARCHAR(20) NULL,
    `confidence` DOUBLE NULL,
    `compare_label` VARCHAR(20) NULL,
    `deviation_sigma` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_motion_feature_result_video_id`(`video_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rep_evaluation_result` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `video_id` BIGINT UNSIGNED NOT NULL,
    `rep_id` INTEGER NOT NULL,
    `accuracy_score` DOUBLE NULL,
    `stability_score` DOUBLE NULL,
    `control_score` DOUBLE NULL,
    `duration_score` DOUBLE NULL,
    `total_score` DOUBLE NULL,
    `grade` VARCHAR(20) NULL,
    `valid_flag` BOOLEAN NOT NULL DEFAULT true,
    `compensation_types` JSON NULL,
    `hold_duration` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_rep_evaluation_result_video_id`(`video_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_evaluation_result` (
    `video_id` BIGINT UNSIGNED NOT NULL,
    `total_reps` INTEGER NOT NULL DEFAULT 0,
    `valid_reps` INTEGER NOT NULL DEFAULT 0,
    `average_score` DOUBLE NULL,
    `grade` VARCHAR(20) NULL,
    `accuracy_avg` DOUBLE NULL,
    `stability_avg` DOUBLE NULL,
    `control_avg` DOUBLE NULL,
    `duration_avg` DOUBLE NULL,
    `avg_hold_duration` DOUBLE NULL,
    `main_issues` JSON NULL,
    `advice_summary` JSON NULL,
    `confidence_score` DOUBLE NULL,
    `analysis_version` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`video_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback` (
    `feedback_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `video_id` BIGINT UNSIGNED NULL,
    `feedback_type` VARCHAR(30) NOT NULL,
    `content` TEXT NOT NULL,
    `image_urls` JSON NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'pending',
    `priority_level` VARCHAR(20) NOT NULL DEFAULT 'normal',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_feedback_user_id`(`user_id`),
    PRIMARY KEY (`feedback_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback_reply` (
    `reply_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `feedback_id` BIGINT UNSIGNED NOT NULL,
    `replier_account_id` BIGINT UNSIGNED NULL,
    `reply_content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_feedback_reply_feedback_id`(`feedback_id`),
    PRIMARY KEY (`reply_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `badge_definition` (
    `badge_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `badge_code` VARCHAR(50) NOT NULL,
    `title` VARCHAR(50) NOT NULL,
    `description` TEXT NULL,
    `trigger_rule` JSON NULL,
    `status` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `badge_definition_badge_code_key`(`badge_code`),
    PRIMARY KEY (`badge_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_badge` (
    `user_badge_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `badge_id` BIGINT UNSIGNED NOT NULL,
    `awarded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `meta` JSON NULL,

    UNIQUE INDEX `uk_user_badge`(`user_id`, `badge_id`),
    PRIMARY KEY (`user_badge_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `notification_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `notification_type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `content` TEXT NOT NULL,
    `related_id` VARCHAR(50) NULL,
    `read_flag` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_notification_user_read`(`user_id`, `read_flag`),
    PRIMARY KEY (`notification_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_config` (
    `config_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `config_key` VARCHAR(100) NOT NULL,
    `config_value` JSON NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `system_config_config_key_key`(`config_key`),
    PRIMARY KEY (`config_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `guidance_content_version` ADD CONSTRAINT `guidance_content_version_content_id_fkey` FOREIGN KEY (`content_id`) REFERENCES `guidance_content`(`content_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_video` ADD CONSTRAINT `training_video_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `analysis_task` ADD CONSTRAINT `analysis_task_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `motion_feature_result` ADD CONSTRAINT `motion_feature_result_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rep_evaluation_result` ADD CONSTRAINT `rep_evaluation_result_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `video_evaluation_result` ADD CONSTRAINT `video_evaluation_result_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `feedback_reply` ADD CONSTRAINT `feedback_reply_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`feedback_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_badge` ADD CONSTRAINT `user_badge_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_badge` ADD CONSTRAINT `user_badge_badge_id_fkey` FOREIGN KEY (`badge_id`) REFERENCES `badge_definition`(`badge_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
