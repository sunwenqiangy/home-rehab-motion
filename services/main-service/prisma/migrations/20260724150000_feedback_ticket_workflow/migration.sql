ALTER TABLE `feedback`
  ADD COLUMN `handling_mode` VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN `last_message_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN `first_replied_at` DATETIME(3) NULL,
  ADD COLUMN `closed_at` DATETIME(3) NULL,
  ADD COLUMN `closed_by` VARCHAR(30) NULL,
  ADD COLUMN `close_reason` VARCHAR(30) NULL;

UPDATE `feedback` SET `last_message_at` = `updated_at` WHERE `last_message_at` IS NULL;

CREATE INDEX `idx_feedback_status_last_message` ON `feedback`(`status`, `last_message_at`);
CREATE INDEX `idx_feedback_handling_status` ON `feedback`(`handling_mode`, `status`);

CREATE TABLE `feedback_message` (
  `message_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `feedback_id` BIGINT UNSIGNED NOT NULL,
  `sender_role` VARCHAR(20) NOT NULL,
  `sender_id` BIGINT UNSIGNED NULL,
  `message_type` VARCHAR(30) NOT NULL DEFAULT 'text',
  `content` TEXT NOT NULL,
  `image_urls` JSON NULL,
  `template_code` VARCHAR(50) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`message_id`),
  INDEX `idx_feedback_message_ticket_time` (`feedback_id`, `created_at`),
  CONSTRAINT `feedback_message_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`feedback_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `feedback_status_log` (
  `log_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `feedback_id` BIGINT UNSIGNED NOT NULL,
  `from_status` VARCHAR(30) NULL,
  `to_status` VARCHAR(30) NOT NULL,
  `operator_role` VARCHAR(20) NOT NULL,
  `operator_id` BIGINT UNSIGNED NULL,
  `reason` VARCHAR(50) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`log_id`),
  INDEX `idx_feedback_status_log_ticket_time` (`feedback_id`, `created_at`),
  CONSTRAINT `feedback_status_log_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `feedback`(`feedback_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `feedback_message` (`feedback_id`, `sender_role`, `sender_id`, `content`, `image_urls`, `created_at`)
SELECT `feedback_id`, 'patient', `user_id`, `content`, `image_urls`, `created_at`
FROM `feedback`;

INSERT INTO `feedback_message` (`feedback_id`, `sender_role`, `sender_id`, `content`, `image_urls`, `created_at`)
SELECT `feedback_id`, 'staff', `replier_account_id`, `reply_content`, JSON_ARRAY(), `created_at`
FROM `feedback_reply`;

INSERT INTO `feedback_status_log` (`feedback_id`, `to_status`, `operator_role`, `operator_id`, `reason`, `created_at`)
SELECT `feedback_id`, `status`, 'system', NULL, 'legacy_import', `created_at`
FROM `feedback`;
