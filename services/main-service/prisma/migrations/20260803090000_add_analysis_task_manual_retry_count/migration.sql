ALTER TABLE `analysis_task`
  ADD COLUMN `manual_retry_count` INTEGER NOT NULL DEFAULT 0 AFTER `retry_count`;

-- 历史每次管理员“重新分析”都会新建 analysis_run；自动入队补偿不会创建 run。
-- 以首个 run 作为初次分析，回填此前已经发生过的管理员重新分析次数。
UPDATE `analysis_task` AS task
JOIN (
  SELECT `video_id`, GREATEST(COUNT(*) - 1, 0) AS `manual_retry_count`
  FROM `analysis_run`
  GROUP BY `video_id`
) AS runs ON runs.`video_id` = task.`video_id`
SET task.`manual_retry_count` = runs.`manual_retry_count`;
