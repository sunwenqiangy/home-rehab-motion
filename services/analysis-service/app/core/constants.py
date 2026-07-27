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
        'abdominal_displacement': {'mean': 15.0, 'std': 3.0, 'unit': 'mm'},
        'displacement_velocity': {'mean': 8.0, 'std': 2.5, 'unit': 'mm/s'},
        'hold_duration': {'mean': 5.0, 'std': 1.5, 'unit': 's'},
        'trunk_angle_change': {'mean': 2.0, 'std': 1.5, 'unit': 'deg'},
    },
    'pelvic_tilt': {
        'pelvic_tilt_delta': {'mean': 10.0, 'std': 2.5, 'unit': 'deg'},
        'pelvis_shift': {'mean': 3.0, 'std': 1.0, 'unit': '%'},
        'hold_duration': {'mean': 4.0, 'std': 1.2, 'unit': 's'},
        'trunk_angle_change': {'mean': 2.0, 'std': 1.5, 'unit': 'deg'},
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
        'trunk_angle_change': {'mean': 2.0, 'std': 1.2, 'unit': 'deg'},
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
        'patient_text': '训练过程中躯干晃动较大，尝试收紧核心保持上身稳定',
        'nurse_text': 'trunk_angle_change 偏高，可能存在躯干代偿',
    },
    'ADV_PELVIS_SHIFT': {
        'trigger': {'feature': 'pelvis_shift', 'label': ['warning', 'invalid']},
        'patient_text': '骨盆位移较大，尽量保持骨盆稳定不动',
        'nurse_text': 'pelvis_shift 偏高，骨盆控制不足',
    },
    'ADV_HOLD_DURATION': {
        'trigger': {'feature': 'hold_duration', 'label': ['warning', 'invalid']},
        'patient_text': '保持时间不足，尝试在目标位置多停留几秒',
        'nurse_text': 'hold_duration 低于有效区间',
    },
    'ADV_ABD_AMPLITUDE': {
        'trigger': {'feature': 'abdominal_displacement', 'label': ['warning', 'invalid']},
        'patient_text': '腹部收缩幅度不够，尝试更深地向内收紧腹部',
        'nurse_text': 'abdominal_displacement 低于有效区间',
    },
    'ADV_KNEE_ROTATION_RANGE': {
        'trigger': {'feature': 'knee_rotation_angle', 'label': ['warning', 'invalid']},
        'patient_text': '膝关节左右摆动幅度不够或过大，建议在舒适范围内平稳完成双向旋转',
        'nurse_text': 'knee_rotation_angle 偏离参考区间，需复核旋转幅度',
    },
    'ADV_KNEE_SYMMETRY': {
        'trigger': {'feature': 'knee_symmetry', 'label': ['warning', 'invalid']},
        'patient_text': '左右两侧旋转幅度不够均衡，尝试让两侧动作幅度保持一致',
        'nurse_text': 'knee_symmetry 偏低，左右旋转控制不均衡',
    },
    'ADV_KNEE_ROTATION_SPEED': {
        'trigger': {'feature': 'rotation_velocity', 'label': ['warning', 'invalid']},
        'patient_text': '旋转节奏偏快或偏慢，建议放慢动作并保持左右方向匀速完成',
        'nurse_text': 'rotation_velocity 偏离参考区间，旋转节奏控制不足',
    },
    'ADV_LOW_CONFIDENCE': {
        'trigger': {'confidence_level': 'medium'},
        'patient_text': '本次分析结果可信度一般，建议在光线充足的环境下重新录制',
        'nurse_text': '综合置信度偏低，结果仅供参考',
    },
    'ADV_PELVIC_TILT_RANGE': {
        'trigger': {'feature': 'pelvic_tilt_delta', 'label': ['warning', 'invalid']},
        'patient_text': '骨盆倾斜幅度不够，尝试更大幅度地前后倾斜骨盆',
        'nurse_text': 'pelvic_tilt_delta 低于有效区间',
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

# 分析服务版本号
ANALYSIS_VERSION = 'as-v1.0.0'
