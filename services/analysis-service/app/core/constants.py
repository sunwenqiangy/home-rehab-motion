"""关键点索引映射与常量定义"""

# MediaPipe Pose 关键点索引 → 业务语义
KEYPOINT_MAP = {
    'LEFT_SHOULDER': 11,
    'RIGHT_SHOULDER': 12,
    'LEFT_HIP': 23,
    'RIGHT_HIP': 24,
    'LEFT_KNEE': 25,
    'RIGHT_KNEE': 26,
    'LEFT_ANKLE': 27,
    'RIGHT_ANKLE': 28,
}

# 关键点名称列表（用于质量检测）
QUALITY_KEYPOINTS = [
    'LEFT_HIP', 'RIGHT_HIP',
    'LEFT_SHOULDER', 'RIGHT_SHOULDER',
    'LEFT_KNEE', 'RIGHT_KNEE',
]

# 各动作类型的参数列表
ACTION_PARAMS = {
    'abdominal_crunch': [
        'abdominal_displacement',
        'displacement_velocity',
        'hold_duration',
        'trunk_angle_change',
    ],
    'pelvic_tilt': [
        'pelvic_tilt_delta',
        'pelvis_shift',
        'hold_duration',
        'trunk_angle_change',
    ],
    'knee_rotation': [
        'knee_rotation_angle',
        'knee_symmetry',
        'rotation_velocity',
        'trunk_angle_change',
    ],
}

# 各动作特征到评分维度的唯一映射。参数计算、模板和评分均以 ACTION_PARAMS 为准。
FEATURE_DIMENSIONS = {
    'abdominal_crunch': {
        'abdominal_displacement': 'accuracy',
        'trunk_angle_change': 'stability',
        'displacement_velocity': 'control',
        'hold_duration': 'duration',
    },
    'pelvic_tilt': {
        'pelvic_tilt_delta': 'accuracy',
        'pelvis_shift': 'stability',
        'trunk_angle_change': 'stability',
        'hold_duration': 'duration',
    },
    'knee_rotation': {
        'knee_rotation_angle': 'accuracy',
        'trunk_angle_change': 'stability',
        'knee_symmetry': 'control',
        'rotation_velocity': 'control',
    },
}

# 评分权重
DEFAULT_WEIGHTS = {
    'accuracy': 0.40,
    'stability': 0.25,
    'control': 0.20,
    'duration': 0.15,
}

# 评分等级
GRADES = [
    (90, 100, '优秀'),
    (75, 89, '合格'),
    (60, 74, '需改进'),
    (0, 59, '无效'),
]

# 金标准默认模板（用于无数据库连接时的 fallback）
DEFAULT_TEMPLATES = {
    'abdominal_crunch': {
        'abdominal_displacement': {'mean': 1.5, 'std': 1.0, 'unit': 'deg'},
        'displacement_velocity': {'mean': 0.5, 'std': 0.5, 'unit': 'deg/s'},
        'hold_duration': {'mean': 5.0, 'std': 1.5, 'unit': 's'},
        'trunk_angle_change': {'mean': 2.0, 'std': 1.5, 'unit': 'deg'},
    },
    'pelvic_tilt': {
        # pelvic_tilt_delta: 画面平面内左右髋连线角度的极差（2D），单位：度。
        # 实测标定（基于标准教学视频）：
        #   缩腹视频误选骨盆模式：1.377°~2.18°（2D 髋线噪声摆动）
        #   真实骨盆倾斜视频：4.787°~20.83°
        # 分隔区间 2.18° < X < 4.787°，取 warning_min=2.5, normal_min=3.0
        #   缩腹误选 → 全部 invalid（<2.5°）→ 触发 accuracy_invalid 限幅 ≤40 分
        #   真实骨盆（≥4.787°）→ normal（>3.0°）→ 正常评分
        #   幅度不足（2.5°~3.0°）→ warning → 低分但不被限幅
        'pelvic_tilt_delta': {
            'mean': 6.0, 'std': 2.5, 'unit': 'deg',
            'scoring_mode': 'lower_bound', 'normal_min': 3.0, 'warning_min': 2.5,
        },
        'pelvis_shift': {'mean': 1.5, 'std': 1.0, 'unit': '%', 'scoring_mode': 'upper_bound', 'normal_max': 1.5, 'warning_max': 3.0},
        'hold_duration': {'mean': 5.0, 'std': 2.0, 'unit': 's'},
        'trunk_angle_change': {'mean': 2.0, 'std': 1.5, 'unit': 'deg', 'scoring_mode': 'upper_bound', 'normal_max': 3.0, 'warning_max': 5.0},
    },
    'knee_rotation': {
        # knee_rotation_angle 单位：归一化 ×100（双膝中点 X 轴相对休息位的单向最大偏移）
        # 计算逻辑：以 rep 前3帧为休息位基准，取最大单向偏移，×100
        # 标准动作单向幅度约 40~75%（充分发力时偏大），mean=57 std=18
        # warning 阈值: ~30% 或 ~84%；invalid 阈值: ~21% 或 ~93%
        'knee_rotation_angle': {'mean': 57.0, 'std': 18.0, 'unit': '%'},
        # knee_symmetry 实测：mean≈0.77，trimmed std≈0.17
        'knee_symmetry': {'mean': 0.78, 'std': 0.18, 'unit': ''},
        # rotation_velocity 实测：mean≈15.7，trimmed std≈4.2
        'rotation_velocity': {'mean': 15.0, 'std': 5.0, 'unit': '%/s'},
        # trunk_angle_change：膝关节旋转含屈膝+双向转动，躯干有一定晃动属正常
        # 实测mean≈1.35，std≈0.77；设 mean=2.0 std=1.2，让3.5°只触发 warning（σ≈1.25）
        # invalid 阈值在 5.6°，warning 阈值在 3.8°，低于此均正常
        'trunk_angle_change': {'mean': 2.0, 'std': 1.2, 'unit': 'deg', 'scoring_mode': 'upper_bound', 'normal_max': 3.5, 'warning_max': 5.6},
    },
}

# 默认阈值配置
DEFAULT_THRESHOLDS = {
    'confidence_min': 0.6,
    'sigma_multiplier': 1.5,
}

# 建议规则模板
ADVICE_RULES = {
    'ADV_TRUNK_STABILITY': {
        'trigger': {'feature': 'trunk_angle_change', 'label': ['warning', 'invalid']},
        'patient_text': '上身有些晃动。下次可轻轻收紧腹部，让躯干尽量保持稳定。',
        'nurse_text': 'trunk_angle_change 在多次动作中偏高，可能存在躯干代偿',
    },
    'ADV_PELVIS_SHIFT': {
        'trigger': {'feature': 'pelvis_shift', 'label': ['warning', 'invalid']},
        'patient_text': '骨盆有额外滑动。下次可放慢速度，除目标倾斜外尽量减少骨盆偏移。',
        'nurse_text': 'pelvis_shift 在多次动作中偏高，存在额外骨盆偏移',
    },
    'ADV_HOLD_DURATION': {
        'trigger': {'feature': 'hold_duration', 'label': ['warning', 'invalid']},
        'patient_text': '在目标位置停留时间偏短。下次可在舒适的情况下多停一小会儿，再慢慢回到起始位置。',
        'nurse_text': 'hold_duration 在多次动作中低于有效区间',
    },
    'ADV_ABD_AMPLITUDE': {
        'trigger': {'feature': 'abdominal_displacement', 'label': ['warning', 'invalid']},
        'patient_text': '收腹幅度可以再清楚一些。请在不憋气、不疼痛的前提下，缓慢向内收紧腹部。',
        'nurse_text': 'abdominal_displacement 在多次动作中低于有效区间',
    },
    'ADV_KNEE_ROTATION_RANGE': {
        'trigger': {'feature': 'knee_rotation_angle', 'label': ['warning', 'invalid']},
        'patient_text': '左右旋转幅度有些不均匀。请在舒适范围内，平稳完成双向旋转。',
        'nurse_text': 'knee_rotation_angle 在多次动作中偏离参考区间，需复核旋转幅度',
    },
    'ADV_KNEE_SYMMETRY': {
        'trigger': {'feature': 'knee_symmetry', 'label': ['warning', 'invalid']},
        'patient_text': '左右两侧的旋转幅度有些不一样。下次可放慢速度，让两边尽量做得一样大。',
        'nurse_text': 'knee_symmetry 在多次动作中偏低，左右旋转控制不均衡',
    },
    'ADV_KNEE_ROTATION_SPEED': {
        'trigger': {'feature': 'rotation_velocity', 'label': ['warning', 'invalid']},
        'patient_text': '旋转速度有些不均匀。下次可适当放慢，左右两边用相近的速度完成。',
        'nurse_text': 'rotation_velocity 在多次动作中偏离参考区间，旋转节奏控制不足',
    },
    'ADV_LOW_CONFIDENCE': {
        'trigger': {'confidence_level': 'medium'},
        'patient_text': '本次分析结果可信度一般，建议在光线充足的环境下重新录制',
        'nurse_text': '综合置信度偏低，结果仅供参考',
    },
    'ADV_PELVIC_TILT_RANGE': {
        'trigger': {'feature': 'pelvic_tilt_delta', 'label': ['warning', 'invalid']},
        'patient_text': '骨盆前后倾幅度可以再明显一些。请在舒适范围内慢慢完成，不要用力过猛。',
        'nurse_text': 'pelvic_tilt_delta 在多次动作中低于有效区间',
    },
}

# 骨架连接定义（用于前端可视化绘制骨骼线）
SKELETON_CONNECTIONS = [
    ('LEFT_SHOULDER', 'RIGHT_SHOULDER'),
    ('LEFT_SHOULDER', 'LEFT_HIP'),
    ('RIGHT_SHOULDER', 'RIGHT_HIP'),
    ('LEFT_HIP', 'RIGHT_HIP'),
    ('LEFT_SHOULDER', 'LEFT_KNEE'),
    ('RIGHT_SHOULDER', 'RIGHT_KNEE'),
    ('LEFT_KNEE', 'LEFT_ANKLE'),
    ('RIGHT_KNEE', 'RIGHT_ANKLE'),
]

# 缩腹闭环切分配置。时间值必须由实际 effective_sample_fps 换算为帧数。
ABDOMINAL_SEGMENTATION_VERSION_LEGACY = 'abdominal_peak_v1'
ABDOMINAL_SEGMENTATION_VERSION_CYCLE = 'abdominal_cycle_v3'
ABDOMINAL_SEGMENT_CONFIG = {
    'min_stable_seconds': 0.6,
    'min_contraction_seconds': 0.8,
    'min_return_seconds': 0.8,
    # 真实患者连续缩腹可在约 2.8 秒完成一个“收缩→回落”往返；3.5 秒会
    # 系统性漏掉此类已闭环的有效动作，仍保留 2.5 秒抑制呼吸/单帧抖动。
    'min_cycle_seconds': 2.5,
    'max_cycle_seconds': 18.0,
    'noise_floor_deg': 0.20,
    # 患者弱收缩的完整局部周期可低至全程稳健极差的约 15%；完整回落、时长
    # 与稳定证据仍是必选条件，不能仅由小幅峰独立计数。
    'candidate_relative_amplitude_ratio': 0.15,
    'rebound_relative_amplitude_ratio': 0.20,
    'tail_min_return_ratio': 0.45,
}

# 分析服务版本号
ANALYSIS_VERSION = 'as-v1.0.0'
