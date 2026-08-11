-- P0：保存实际正式切分版本与 Shadow 轻量诊断；不新增患者基线或报告字段。
ALTER TABLE `video_evaluation_result`
  ADD COLUMN `segmentation_version` VARCHAR(64) NULL AFTER `threshold_snapshot`,
  ADD COLUMN `segmentation_snapshot` JSON NULL AFTER `segmentation_version`;
