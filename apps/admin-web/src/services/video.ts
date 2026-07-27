import { request } from '@/utils/request';
import type { ManualVideoReviewDto, SaveManualVideoReviewRequestDto } from '@home-rehab-motion/shared-contract';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';

export interface AdminVideoItem {
  videoId: number;
  actionType: TrainingActionType;
  status: AnalysisStatus;
  uploadedAt?: string;
  patientName?: string;
  qualityStatus?: string | null;
}

export interface AdminVideoDetail {
  videoId: number;
  actionType: TrainingActionType;
  status: AnalysisStatus;
  qualityStatus: string;
  uploadedAt?: string;
  patientName?: string;
  qualityScore?: number | null;
  failReason?: string | null;
  taskStatus?: string | null;
  averageScore?: number | null;
  grade?: string | null;
  videoKey?: string | null;
  videoPreviewUrl?: string | null;
}

export interface KeypointData {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface KeypointFrame {
  frame_index: number;
  timestamp: number;
  keypoints: Record<string, KeypointData>;
  hip_mid?: number[];
  shoulder_mid?: number[];
}

export interface KeypointRepSegment {
  rep_id: number;
  start_frame: number;
  end_frame: number;
  start_time: number;
  end_time: number;
  phases?: Record<string, number>;
}

export interface KeypointsData {
  video_id: number;
  total_frames: number;
  keypoint_names: string[];
  skeleton_connections: string[][];
  frames: KeypointFrame[];
  rep_segments?: KeypointRepSegment[];
  message?: string;
}

export interface AdminVideoAnalysisDetail {
  videoId: number;
  analysisStatus: AnalysisStatus;
  taskStatus: string;
  qualityStatus: string | null;
  qualityScore: number | null;
  reportReady: boolean;
  summary: {
    averageScore: number | null;
    grade: string | null;
    totalReps: number;
    validReps: number;
    confidenceScore: number | null;
    accuracyAvg: number | null;
    stabilityAvg: number | null;
    controlAvg: number | null;
    durationAvg: number | null;
    avgHoldDuration: number | null;
    mainIssues: unknown[];
    adviceSummary: unknown[];
  } | null;
  scoringExplain: {
    gradeRanges: Array<{ min: number; max: number; grade: string }>;
    weights: { accuracy: number; stability: number; control: number; duration: number };
    scoringHint: string;
  };
  repScores: Array<{
    repId: number | null;
    accuracyScore: number | null;
    stabilityScore: number | null;
    controlScore: number | null;
    durationScore: number | null;
    totalScore: number | null;
    grade: string | null;
    validFlag: boolean;
    compensationTypes: string[];
  }>;
  featureRows: Array<{
    repId: number | null;
    featureCode: string;
    compareLabel: string | null;
    deviationSigma: number | null;
    confidence: number | null;
  }>;
}

/** 获取视频列表（管理端） */
export function getAdminVideoList(): Promise<AdminVideoItem[]> {
  return request<AdminVideoItem[]>({
    url: '/videos/admin/list',
    method: 'GET',
  });
}

/** 获取视频详情（管理端） */
export function getAdminVideoDetail(videoId: number): Promise<AdminVideoDetail> {
  return request<AdminVideoDetail>({
    url: `/videos/admin/${videoId}`,
    method: 'GET',
  });
}

export function getManualVideoReview(videoId: number): Promise<ManualVideoReviewDto | null> {
  return request<ManualVideoReviewDto | null>({ url: `/videos/admin/${videoId}/manual-review`, method: 'GET' });
}

export function saveManualVideoReview(videoId: number, payload: SaveManualVideoReviewRequestDto): Promise<ManualVideoReviewDto> {
  return request<ManualVideoReviewDto>({ url: `/videos/admin/${videoId}/manual-review`, method: 'POST', data: payload });
}

/** 获取视频关键点数据（骨架可视化） */
export function getAdminVideoKeypoints(videoId: number): Promise<KeypointsData> {
  return request<KeypointsData>({
    url: `/videos/admin/${videoId}/keypoints`,
    method: 'GET',
  });
}

/** 获取视频分析详情（评分解释 + 特征明细） */
export function getAdminVideoAnalysisDetail(videoId: number): Promise<AdminVideoAnalysisDetail> {
  return request<AdminVideoAnalysisDetail>({
    url: `/videos/admin/${videoId}/analysis-detail`,
    method: 'GET',
  });
}
