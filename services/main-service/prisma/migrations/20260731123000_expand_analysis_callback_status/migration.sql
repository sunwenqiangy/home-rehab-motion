ALTER TABLE `analysis_task`
  MODIFY COLUMN `callback_status` VARCHAR(32) NOT NULL DEFAULT 'pending';
