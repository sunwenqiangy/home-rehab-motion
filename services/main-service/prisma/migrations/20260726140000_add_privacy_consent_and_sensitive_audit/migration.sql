CREATE TABLE `patient_privacy_consent` (
  `consent_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `policy_version` VARCHAR(32) NOT NULL,
  `consented_at` DATETIME(3) NULL,
  `withdrawn_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`consent_id`),
  UNIQUE INDEX `patient_privacy_consent_user_id_key`(`user_id`),
  INDEX `idx_privacy_consent_consented_at`(`consented_at`),
  CONSTRAINT `patient_privacy_consent_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `user_profile`(`user_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sensitive_access_audit` (
  `audit_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_account_id` BIGINT UNSIGNED NULL,
  `actor_role` VARCHAR(20) NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `resource_type` VARCHAR(40) NOT NULL,
  `resource_id` VARCHAR(80) NOT NULL,
  `patient_id` BIGINT UNSIGNED NULL,
  `request_ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  `result` VARCHAR(20) NOT NULL DEFAULT 'success',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`audit_id`),
  INDEX `idx_sensitive_access_audit_patient_time`(`patient_id`, `created_at`),
  INDEX `idx_sensitive_access_audit_actor_time`(`actor_account_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
