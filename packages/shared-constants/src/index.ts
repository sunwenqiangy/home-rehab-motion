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
