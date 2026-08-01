"""分析任务相关 Pydantic Schema"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ─── 请求 ───────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    """提交分析任务请求"""
    video_id: int = Field(..., description='训练视频 ID')
    action_type: str = Field(..., description='动作类型: abdominal_crunch / pelvic_tilt / knee_rotation')
    video_key: Optional[str] = Field(None, description='OSS 对象 Key')
    analysis_run_id: str = Field(..., min_length=36, max_length=36, description='主服务生成的分析运行 ID')
    callback_url: Optional[str] = Field(None, description='分析完成后的回调 URL')
    sample_fps: Optional[int] = Field(None, description='采样帧率（5~30，默认使用服务配置）')
    priority: int = Field(default=0, description='任务优先级，0=普通，1=高优')
    threshold_config: Optional[Dict[str, Any]] = Field(None, description='覆盖默认阈值配置')


class CallbackPayload(BaseModel):
    """分析完成后回调主服务的 payload"""
    video_id: int
    analysis_run_id: str
    provider_task_id: Optional[str] = None
    analysis_status: str = Field(..., description='completed / failed')
    quality_status: Optional[str] = None
    quality_score: Optional[float] = None
    quality_issues: Optional[List[Dict[str, Any]]] = None
    fail_reason: Optional[str] = None
    video_evaluation: Optional[Dict[str, Any]] = None
    rep_evaluations: Optional[List[Dict[str, Any]]] = None
    motion_features: Optional[List[Dict[str, Any]]] = None
    analysis_version: Optional[str] = None


# ─── 响应 ───────────────────────────────────────────────

class AnalyzeResponse(BaseModel):
    """提交分析任务响应"""
    task_id: str = Field(..., description='Celery 任务 ID')
    video_id: int
    status: str = Field(default='queued', description='任务状态')


class TaskStatusResponse(BaseModel):
    """任务状态查询响应"""
    task_id: str
    video_id: int
    task_status: str = Field(..., description='pending / processing / completed / failed')
    progress: Optional[float] = Field(None, description='进度 0~1')
    fail_reason: Optional[str] = None
    result: Optional[Dict[str, Any]] = None


class QualityCheckResponse(BaseModel):
    """视频质检结果"""
    quality_status: str
    avg_visibility: float
    resolution: str
    duration: float
    fps: float
    brightness_warning: bool = False
    completeness_warning: bool = False
    details: Dict[str, Any] = Field(default_factory=dict)


class CompareResultSchema(BaseModel):
    """金标准比对结果"""
    feature_code: str
    measured: float
    reference_mean: float
    reference_std: float
    deviation_sigma: float
    label: str
    in_valid_range: bool


class RepScoreSchema(BaseModel):
    """单次动作评分"""
    rep_id: int
    accuracy_score: float
    stability_score: float
    control_score: float
    duration_score: float
    total_score: float
    grade: str
    valid_flag: bool = True
    compensation_types: List[str] = Field(default_factory=list)
    hold_duration: float = 0.0
    compare_results: List[CompareResultSchema] = Field(default_factory=list)


class VideoScoreSchema(BaseModel):
    """视频级综合评分"""
    video_id: int
    total_reps: int
    valid_reps: int
    average_score: float
    grade: str
    accuracy_avg: float
    stability_avg: float
    control_avg: float
    duration_avg: float
    avg_hold_duration: float
    main_issues: List[Dict[str, Any]] = Field(default_factory=list)
    advice_summary: List[Dict[str, Any]] = Field(default_factory=list)
    confidence_score: float = 0.0
    analysis_version: str = ''


class ConfidenceSchema(BaseModel):
    """三层置信度"""
    overall: float
    video_quality: float
    keypoint_quality: float
    parameter_reliability: float
    level: str


class KeypointData(BaseModel):
    """单帧内某个关键点的坐标"""
    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0


class KeypointFrame(BaseModel):
    """单帧关键点集合"""
    frame_index: int
    timestamp: float
    keypoints: Dict[str, KeypointData]
    hip_mid: Optional[List[float]] = None
    shoulder_mid: Optional[List[float]] = None


class KeypointRepSegment(BaseModel):
    """单次动作切片区间（用于前端周期计数可视化）"""
    rep_id: int
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    phases: Dict[str, int] = Field(default_factory=dict)


class KeypointsResponse(BaseModel):
    """关键点帧数据响应（骨架可视化用）"""
    video_id: int
    total_frames: int
    keypoint_names: List[str]
    skeleton_connections: List[List[str]]
    frames: List[KeypointFrame]
    rep_segments: List[KeypointRepSegment] = Field(default_factory=list)


class AnalysisResultResponse(BaseModel):
    """完整分析结果响应"""
    video_id: int
    action_type: str
    quality: QualityCheckResponse
    confidence: ConfidenceSchema
    video_score: VideoScoreSchema
    rep_scores: List[RepScoreSchema] = Field(default_factory=list)
    analysis_version: str = ''
