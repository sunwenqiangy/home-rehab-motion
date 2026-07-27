-- CreateTable
CREATE TABLE `manual_video_review` (
    `review_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `video_id` BIGINT UNSIGNED NOT NULL,
    `algorithm_score` DOUBLE NULL,
    `algorithm_grade` VARCHAR(20) NULL,
    `algorithm_main_issues` JSON NULL,
    `algorithm_advice_summary` JSON NULL,
    `algorithm_valid_reps` INTEGER NULL,
    `algorithm_total_reps` INTEGER NULL,
    `algorithm_confidence` DOUBLE NULL,
    `algorithm_version` VARCHAR(40) NULL,
    `accuracy_judgment` VARCHAR(20) NOT NULL,
    `disposition` VARCHAR(20) NOT NULL,
    `use_manual_result` BOOLEAN NOT NULL DEFAULT false,
    `manual_score` DOUBLE NULL,
    `manual_grade` VARCHAR(20) NULL,
    `manual_main_issues` JSON NULL,
    `manual_advice` TEXT NULL,
    `review_note` TEXT NULL,
    `reviewer_account_id` BIGINT UNSIGNED NULL,
    `reviewer_name` VARCHAR(50) NULL,
    `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `manual_video_review_video_id_key`(`video_id`),
    INDEX `idx_manual_review_judgment`(`accuracy_judgment`),
    INDEX `idx_manual_review_reviewed_at`(`reviewed_at`),
    PRIMARY KEY (`review_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `manual_video_review` ADD CONSTRAINT `manual_video_review_video_id_fkey` FOREIGN KEY (`video_id`) REFERENCES `training_video`(`video_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
