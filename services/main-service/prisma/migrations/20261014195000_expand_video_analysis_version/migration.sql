-- 视觉练习分版本名超过旧 VARCHAR(20)，导致报告保存失败。
ALTER TABLE `video_evaluation_result`
  MODIFY COLUMN `analysis_version` VARCHAR(64) NULL;
