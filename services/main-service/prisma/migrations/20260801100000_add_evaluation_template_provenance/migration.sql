-- 分析结果必须记录实际使用的金标准模板，避免阈值调整后无法追溯历史评分依据。
ALTER TABLE `video_evaluation_result`
  ADD COLUMN `template_id` BIGINT UNSIGNED NULL AFTER `analysis_version`,
  ADD COLUMN `template_version` VARCHAR(64) NULL AFTER `template_id`,
  ADD COLUMN `threshold_snapshot` JSON NULL AFTER `template_version`,
  ADD INDEX `idx_video_evaluation_template_id` (`template_id`);

-- 旧结果产生时未保存模板快照，不能以当前模板反推并伪造历史归属。
-- 显式标记为 legacy_unknown，管理员可通过“重新分析”用原视频补齐准确留痕。
UPDATE `video_evaluation_result`
SET `template_version` = 'legacy_unknown'
WHERE `template_id` IS NULL AND `template_version` IS NULL;
