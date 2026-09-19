ALTER TABLE `analysis_task`
  ADD COLUMN `progress_stage` VARCHAR(30) NULL AFTER `task_status`;
