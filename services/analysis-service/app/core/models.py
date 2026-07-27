"""数据模型定义 — 分析流水线中使用的内部数据结构"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


@dataclass
class Keypoint:
    """单个关键点"""
    x: float
    y: float
    z: float  # proxy depth
    visibility: float


@dataclass
class Frame:
    """一帧的关键点集合"""
    frame_index: int
    timestamp: float  # 秒
    keypoints: Dict[str, Keypoint]
    # 派生虚拟点
    hip_mid: Optional[Tuple[float, float, float]] = None
    shoulder_mid: Optional[Tuple[float, float, float]] = None


@dataclass
class QualityCheckResult:
    """视频质量检测结果"""
    quality_status: str  # passed / warning / insufficient
    avg_visibility: float
    resolution: Tuple[int, int]
    duration: float
    fps: float
    brightness_warning: bool = False
    completeness_warning: bool = False
    details: Dict = field(default_factory=dict)


@dataclass
class Rep:
    """一次动作重复"""
    id: int
    start_frame: int
    end_frame: int
    phases: Dict[str, int] = field(default_factory=dict)  # phase_name -> frame_index


@dataclass
class CompareResult:
    """金标准比对结果"""
    feature_code: str
    measured: float
    reference_mean: float
    reference_std: float
    deviation_sigma: float
    label: str  # normal / warning / invalid
    in_valid_range: bool


@dataclass
class RepScore:
    """单次动作评分"""
    rep_id: int
    accuracy_score: float
    stability_score: float
    control_score: float
    duration_score: float
    total_score: float
    grade: str  # 优秀 / 合格 / 需改进 / 无效
    valid_flag: bool = True
    compensation_types: List[str] = field(default_factory=list)
    hold_duration: float = 0.0


@dataclass
class VideoScore:
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
    main_issues: List[Dict] = field(default_factory=list)
    advice_summary: List[Dict] = field(default_factory=list)
    confidence_score: float = 0.0
    analysis_version: str = ''


@dataclass
class ConfidenceResult:
    """三层置信度"""
    overall: float
    video_quality: float
    keypoint_quality: float
    parameter_reliability: float
    level: str  # high / medium / low
