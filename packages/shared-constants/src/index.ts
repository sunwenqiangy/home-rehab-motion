export const API_PREFIX = '/api';

export const ANALYSIS_STATUS_LABELS = {
  pending: '待创建',
  uploading: '上传中',
  queued: '排队中',
  processing: '分析中',
  completed: '已完成',
  quality_insufficient: '质量不足',
  failed: '已失败',
} as const;

export const VIDEO_QUALITY_STATUS_LABELS = {
  passed: '质量通过',
  warning: '需复核',
  insufficient: '质量不足',
} as const;
