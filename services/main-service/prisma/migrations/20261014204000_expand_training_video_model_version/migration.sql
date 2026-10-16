-- 完成回调也会把分析版本写入 training_video.model_version。
ALTER TABLE `training_video`
  MODIFY COLUMN `model_version` VARCHAR(64) NULL;
