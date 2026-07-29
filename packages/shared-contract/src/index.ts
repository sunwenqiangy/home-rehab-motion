import type {
  AnalysisStatus,
  FeedbackStatus,
  FeedbackType,
  NotificationType,
  ReportStage,
  TrainingActionType,
  UserRole,
  WeeklyProgressStatus,
} from '@home-rehab-motion/shared-types';

export interface GuidanceAssetDto {
  objectKey?: string;
  url: string;
  thumbnailUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface GuidanceStepDto {
  id: string;
  order: number;
  title: string;
  description?: string;
  image?: GuidanceAssetDto;
  altText?: string;
}

export interface ShootingRequirementDto {
  id: string;
  type: 'angle' | 'framing' | 'lighting' | 'stability';
  title: string;
  description: string;
  correctImage: GuidanceAssetDto;
  incorrectImage?: GuidanceAssetDto;
  altText: string;
}

export interface CommonMistakeDto {
  id: string;
  order: number;
  title: string;
  mistakeDescription: string;
  correction: string;
  media?: GuidanceAssetDto;
  correctImage?: GuidanceAssetDto;
}

export interface GuidanceContentDto {
  contentId: number;
  actionType: TrainingActionType;
  title: string;
  briefInstruction: string;
  estimatedMinutes: number;
  coverImage?: GuidanceAssetDto;
  trainingSafetyNotice: string;
  video: { asset?: GuidanceAssetDto; fallbackText?: string };
  steps: GuidanceStepDto[];
  shootingRequirements: ShootingRequirementDto[];
  commonMistakes: CommonMistakeDto[];
  version?: number;
}

export interface GuidanceListItemDto extends Pick<GuidanceContentDto, 'contentId' | 'actionType' | 'title' | 'briefInstruction' | 'estimatedMinutes' | 'coverImage' | 'version'> {}

export interface GuidanceValidationResultDto {
  valid: boolean;
  errors: string[];
}

export interface GuidanceVersionDto {
  contentId: number;
  version: number;
  createdAt: string;
  snapshot: GuidanceContentDto;
}

export interface AdminGuidanceListItemDto {
  contentId: number;
  actionType: TrainingActionType;
  title: string;
  updatedAt: string;
}

export interface WxLoginRequestDto {
  code: string;
  encryptedData?: string;
  iv?: string;
}

export interface WxLoginResponseDto {
  token: string;
  userId: number;
  role: UserRole;
  displayMode: 'elderly' | 'standard';
}

export interface WxPhoneLoginRequestDto {
  /** wx.login 返回的一次性登录凭证。 */
  wxCode: string;
  /** button open-type="getPhoneNumber" 返回的一次性手机号凭证。 */
  phoneCode: string;
}

export interface AdminLoginRequestDto {
  username: string;
  password: string;
}

export interface AdminLoginResponseDto {
  token: string;
  accountId: number;
  role: UserRole;
}

export interface PresignUploadResponseDto {
  videoId: number;
  uploadUrl: string;
  objectKey: string;
  /** local_proxy: 通过 main-service 中转上传；s3_post: 直传 OSS/MinIO */
  uploadType?: 'local_proxy' | 's3_post';
  /** s3_post 模式下用于 multipart/form-data 的额外字段 */
  uploadFields?: Record<string, string>;
}

export interface AssetUploadTargetDto {
  uploadUrl: string;
  objectKey: string;
  assetUrl: string;
  /** local_proxy: 通过 main-service 中转上传；s3_post: 直传 OSS/MinIO */
  uploadType?: 'local_proxy' | 's3_post';
  /** s3_post 模式下用于 multipart/form-data 的额外字段 */
  uploadFields?: Record<string, string>;
}

export interface ConfirmUploadRequestDto {
  videoId: number;
  actionType: TrainingActionType;
  duration: number;
  /** 可选：分析采样帧率（仅在触发重新分析时生效） */
  sampleFps?: number;
  /** 可选：sigma 阈值倍数，会影响参数 normal/warning/invalid 判定边界 */
  sigmaMultiplier?: number;
}

export interface ConfirmUploadResponseDto {
  videoId: number;
  status: AnalysisStatus;
  estimatedWaitSeconds: number;
}

export interface VideoStatusDto {
  videoId: number;
  status: AnalysisStatus;
  reportReady: boolean;
  /** 预计等待秒数 */
  estimatedWaitSeconds?: number;
  /** 失败/质量不足时的用户可读原因 */
  failReason?: string;
}

export type BadgeCode =
  | 'first_try'
  | 'streak_3'
  | 'streak_7'
  | 'days_30'
  | 'days_60'
  | 'days_90'
  | 'first_excellent';

export interface BadgeSummaryDto {
  badgeCode: BadgeCode | string;
  title: string;
  description?: string;
  awardedAt?: string;
  sourceVideoId?: number;
  seenAt?: string;
}

export interface BadgeProgressDto {
  code: BadgeCode | string;
  current: number;
  target: number;
  unit: '天';
  message: string;
}

export interface BadgeWallItemDto {
  badgeCode: BadgeCode | string;
  title: string;
  description?: string;
  unlocked: boolean;
  awardedAt?: string;
  sourceVideoId?: number;
  seenAt?: string;
  progress?: BadgeProgressDto;
}

export interface BadgeWallDto {
  unlockedCount: number;
  totalCount: number;
  items: BadgeWallItemDto[];
  nearestBadge?: BadgeProgressDto;
}

export interface WeeklyCalendarDayDto {
  /** 业务日，按 Asia/Shanghai 计算，格式 YYYY-MM-DD。 */
  date: string;
  /** 周一为 1，周日为 7。 */
  weekday: number;
  /** 当天是否至少确认过一次训练。 */
  trained: boolean;
  /** 当前上海业务日。 */
  isToday: boolean;
}

export interface MotivationSummaryDto {
  totalTrainingCount: number;
  totalTrainingDays: number;
  consecutiveTrainingDays: number;
  weeklyTrainingDays: number;
  weeklyTargetDays: number;
  /** 本周一到周日的真实训练日分布，供周视图渲染。 */
  weeklyCalendar: WeeklyCalendarDayDto[];
  totalQualifiedCount: number;
  latestGrade?: string;
  scoreDelta?: number;
  stabilityDelta?: number;
  durationDelta?: number;
  validRepsDelta?: number;
  improvementLevel: 'none' | 'slight' | 'clear';
  improvementType?: 'score' | 'stability' | 'duration' | 'reps';
  improvementMessage: string;
  stage: ReportStage;
  badges: BadgeSummaryDto[];
  latestBadge?: BadgeSummaryDto;
  nearestBadge?: BadgeProgressDto;
  encourageText: string;
  todayTrainingState: 'not_started' | 'confirmed' | 'analyzing' | 'reported';
}

export interface WeeklyProgressDto {
  weeklyTarget: number;
  currentCount: number;
  /** 本周已完成天数（与 currentCount 相同，前端习惯用 completedDays） */
  completedDays: number;
  progressPercent: number;
  status: WeeklyProgressStatus;
  label: string;
  desc: string;
  carryoverText?: string;
  badges: BadgeSummaryDto[];
}

export type ManualReviewAccuracyJudgment = 'accurate' | 'partially_accurate' | 'inaccurate' | 'unable_to_judge';
export type ManualReviewDisposition = 'archive' | 'manual_correction' | 'suggest_retake' | 'send_guidance';

export interface ManualVideoReviewDto {
  reviewId: number;
  accuracyJudgment: ManualReviewAccuracyJudgment;
  disposition: ManualReviewDisposition;
  useManualResult: boolean;
  manualScore?: number | null;
  manualGrade?: string | null;
  manualMainIssues: string[];
  manualAdvice?: string | null;
  reviewNote?: string | null;
  reviewerName?: string | null;
  reviewedAt: string;
  algorithmSnapshot: {
    score?: number | null;
    grade?: string | null;
    mainIssues: string[];
    validReps?: number | null;
    totalReps?: number | null;
    confidence?: number | null;
    version?: string | null;
  };
}

export interface SaveManualVideoReviewRequestDto {
  accuracyJudgment: ManualReviewAccuracyJudgment;
  disposition: ManualReviewDisposition;
  useManualResult: boolean;
  manualScore?: number | null;
  manualMainIssues?: string[];
  manualAdvice?: string;
  reviewNote?: string;
}

export interface ReportDto {
  videoId: number;
  actionType: TrainingActionType;
  uploadedAt: string;
  duration: number;
  grade: string;
  averageScore: number;
  totalReps: number;
  validReps: number;
  avgHoldDuration: number;
  confidenceScore: number;
  /** 结果因拍摄质量、置信度或模板完整性进入人工复核，患者端不得展示确定性评分。 */
  requiresManualReview?: boolean;
  reviewMessage?: string;
  accuracyAvg?: number;
  stabilityAvg?: number;
  controlAvg?: number;
  durationAvg?: number;
  stage: ReportStage;
  compareToLast?: string;
  trendSummary?: string;
  streakSummary: WeeklyProgressDto;
  badgeSummary: BadgeSummaryDto[];
  motivation?: MotivationSummaryDto;
  newlyUnlockedBadges?: BadgeSummaryDto[];
  mainIssues: string[];
  adviceSummary: Array<{
    adviceCode: string;
    patientText: string;
  }>;
  resultSource?: 'algorithm' | 'manual_review';
  manualReviewSummary?: {
    reviewedAt: string;
    advice?: string;
  };
}

export interface CreateFeedbackRequestDto {
  videoId?: number;
  feedbackType: FeedbackType;
  content: string;
  imageUrls?: string[];
}

export interface FeedbackImageUploadTargetDto extends AssetUploadTargetDto {}

export interface FeedbackMessageDto {
  messageId: number;
  senderRole: 'patient' | 'staff' | 'system';
  content: string;
  imageUrls?: string[];
  createdAt: string;
}

export interface FeedbackStatusLogDto {
  fromStatus?: FeedbackStatus;
  toStatus: FeedbackStatus;
  operatorRole: 'patient' | 'staff' | 'system';
  reason?: string;
  createdAt: string;
}

export interface FeedbackTrainingContextDto {
  videoId: number;
  actionType?: TrainingActionType;
  duration?: number;
  analysisStatus?: AnalysisStatus;
  qualityStatus?: string;
  uploadedAt?: string;
  averageScore?: number;
  grade?: string;
}

export interface FeedbackDto {
  feedbackId: number;
  status: FeedbackStatus;
  feedbackType: FeedbackType;
  content: string;
  imageUrls?: string[];
  videoId?: number;
  replyContent?: string;
  createdAt?: string;
  lastMessageAt?: string;
  handlingMode?: 'manual' | 'safety_auto';
  priorityLevel?: 'normal' | 'high';
  closeReason?: 'resolved' | 'inactive_7d' | 'safety_diversion';
  messages?: FeedbackMessageDto[];
  statusLogs?: FeedbackStatusLogDto[];
  trainingContext?: FeedbackTrainingContextDto;
}

export interface AdminFeedbackListItemDto extends FeedbackDto {
  patientId: number;
  patientName?: string;
}

export interface NotificationDto {
  notificationId: number;
  type: NotificationType;
  title: string;
  content: string;
  readFlag: boolean;
  relatedId?: string;
  createdAt?: string;
}

export interface NotificationUnreadCountDto {
  unreadCount: number;
}

export interface MarkAllNotificationsReadResponseDto {
  updatedCount: number;
}

export interface HistoryVideoDto {
  videoId: number;
  actionType: TrainingActionType;
  status: AnalysisStatus;
  uploadedAt: string;
  reportReady?: boolean;
  averageScore?: number;
  grade?: string;
  duration?: number;
  failReason?: string;
}

export interface TrainingSummaryDto extends MotivationSummaryDto {
  weeklyProgress: WeeklyProgressDto;
  completedCount: number;
  pendingCount: number;
  latestScoreDeltaText?: string;
  latestBestScore?: number;
  /** 历史最高分 */
  maxScore?: number;
  /** 兼容旧页面字段；请使用 consecutiveTrainingDays。 */
  consecutiveCompletedWeeks: number;
  /** 康复第 N 周（基于首次训练日期计算） */
  rehabilitationWeek?: number;
}

export interface UserProfileDto {
  userId: number;
  nickname: string;
  /** 是否已通过微信手机号授权绑定；不向患者端返回手机号明文。 */
  phoneBound: boolean;
  displayMode: 'elderly' | 'standard';
  age?: number;
  gender?: 'male' | 'female' | 'unknown';
}

export interface UpdatePatientProfileRequestDto {
  nickname?: string;
  /** 用户主动填写的年龄；微信登录不会提供年龄。 */
  age?: number;
  /** 用户主动选择的性别；微信登录不会提供性别。 */
  gender?: 'male' | 'female' | 'unknown';
}

export interface BindWechatPhoneRequestDto {
  /** button open-type="getPhoneNumber" 返回的一次性凭证。 */
  code: string;
}

export interface BindWechatPhoneResponseDto {
  phoneBound: boolean;
  /** 仅返回脱敏结果，避免在小程序端暴露完整手机号。 */
  maskedPhone: string;
}

export interface PrivacyConsentStatusDto {
  policyVersion: string;
  consented: boolean;
  consentedAt?: string;
  withdrawnAt?: string;
}

export interface DisplaySettingsDto {
  displayMode: 'elderly' | 'standard';
}

export interface UpdateDisplaySettingsRequestDto {
  displayMode: 'elderly' | 'standard';
}

export interface ThresholdConfigDto {
  actionType: TrainingActionType;
  version: string;
  thresholdConfig: Record<string, unknown>;
}

export interface GoldTemplateVersionDto {
  templateId: number;
  actionType: TrainingActionType;
  version: string;
  description?: string;
  referenceStats: Record<string, unknown>;
  thresholdConfig: Record<string, unknown>;
  status: number;
  createdBy?: string;
  createdAt: string;
}

export interface GoldTemplateVersionListResponseDto {
  items: GoldTemplateVersionDto[];
}

export interface GoldTemplateVersionStatusUpdateRequestDto {
  status: number;
}

export interface GoldTemplateVersionStatusUpdateResponseDto {
  templateId: number;
  status: number;
}

export interface GoldTemplateSourceVideoDto {
  videoId: number;
  actionType: TrainingActionType;
  status: AnalysisStatus;
  uploadedAt: string;
  duration?: number;
  averageScore?: number;
  grade?: string;
}

export interface GoldTemplateSourceVideoListResponseDto {
  items: GoldTemplateSourceVideoDto[];
}

export interface GoldTemplateGenerateRequestDto {
  actionType: TrainingActionType;
  sourceVideoId: number;
  sourceVideoKey?: string;
  sourceVideoName?: string;
  sampleFps?: number;
  sigmaMultiplier?: number;
  notes?: string;
}

export interface GoldTemplateGenerateResponseDto {
  actionType: TrainingActionType;
  sourceVideoId: number;
  sourceVideoKey?: string;
  sourceVideoName?: string;
  qualityReport: {
    avgConfidence?: number;
    missingRate?: number;
    totalFrames?: number;
    totalCycles?: number;
    validCycles?: number;
    invalidCycles?: number;
    validCycleSource?: 'rep_evaluation_results' | 'video_evaluation_result' | 'motion_feature_results';
    qualityPass?: boolean;
    warnings?: string[];
  };
  referenceStats: Record<string, unknown>;
  thresholdConfig: Record<string, unknown>;
  compareSummary?: Record<string, unknown>;
  generatedAt: string;
}

export interface GoldTemplateSaveRequestDto {
  actionType: TrainingActionType;
  version: string;
  description?: string;
  referenceStats: Record<string, unknown>;
  thresholdConfig: Record<string, unknown>;
}

export interface GoldTemplateSaveResponseDto {
  templateId: number;
  actionType: TrainingActionType;
  version: string;
  createdAt: string;
}

/**
 * 患者端应用配置（由后台 system_config 表下发，前端可据此调整行为）
 */
export interface PatientAppConfigDto {
  /** 视频最短时长（秒） */
  videoMinDurationSeconds: number;
  /** 相册上传视频最长时长（秒） */
  videoMaxDurationSeconds: number;
  /** 小程序录制视频最长时长（秒） */
  videoRecordMaxDurationSeconds: number;
  /** 视频大小上限（MB） */
  videoMaxSizeMB: number;
  /** 每周目标天数 */
  weeklyTarget: number;
  /** 分析中页最短停留秒数 */
  analyzingMinWaitSeconds: number;
  /** 支持的动作类型列表 */
  supportedActionTypes: TrainingActionType[];
}

export interface UpdatePatientAppConfigRequestDto {
  videoMinDurationSeconds?: number;
  videoMaxDurationSeconds?: number;
  videoRecordMaxDurationSeconds?: number;
  videoMaxSizeMB?: number;
  weeklyTarget?: number;
  analyzingMinWaitSeconds?: number;
  supportedActionTypes?: TrainingActionType[];
}

export interface MotivationRulesDto {
  scoreSlightDelta: number;
  scoreClearDelta: number;
  stabilitySlightDelta: number;
  stabilityClearDelta: number;
  durationSlightDelta: number;
  durationClearDelta: number;
  repsSlightDelta: number;
  repsClearDelta: number;
}

export interface MotivationOverviewDto {
  confirmedTrainingCount: number;
  trainingDayCount: number;
  earnedBadgeCount: number;
  clearImprovementCount: number;
}
