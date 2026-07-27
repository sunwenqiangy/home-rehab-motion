export type DisplayMode = 'elderly' | 'standard';

export type TrainingActionType =
  | 'abdominal_crunch'
  | 'pelvic_tilt'
  | 'knee_rotation';

export type TrainingVideoSourceType = 'miniapp' | 'admin_flow_verify' | 'gold_template';

export type AnalysisStatus =
  | 'pending'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'quality_insufficient'
  | 'review_required';

export type UserRole = 'patient' | 'nurse' | 'admin';

export type FeedbackType =
  | 'report_question'
  | 'action_issue'
  | 'upload_issue'
  | 'body_discomfort'
  | 'other';

export type FeedbackStatus = 'pending' | 'processing' | 'replied' | 'closed';
export type FeedbackHandlingMode = 'manual' | 'safety_auto';
export type FeedbackMessageSenderRole = 'patient' | 'staff' | 'system';

export type NotificationType =
  | 'analysis_completed'
  | 'feedback_replied'
  | 'badge_earned'
  | 'system_message';

export type ReportStage = 'corrective' | 'consolidation' | 'incentive';

export type WeeklyProgressStatus =
  | 'started'
  | 'target_reached'
  | 'week_completed'
  | 'new_week_after_target'
  | 'new_week_after_completed';
