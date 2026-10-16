"""评分特征与模板的可比性契约；不把不同物理量当作同一指标。"""

from typing import Any, Dict


ABDOMINAL_POSE_FEATURE_SCHEMA = 'abdominal_pose_v2'
ABDOMINAL_POSE_UNITS = {
    'abdominal_displacement': 'deg',
    'displacement_velocity': 'deg/s',
    'hold_duration': 's',
    'trunk_angle_change': 'deg',
}


def assess_scoring_contract(action_type: str, threshold_config: Dict[str, Any]) -> Dict[str, Any]:
    """检查已持久化模板能否与当前缩腹姿态特征直接比较。"""
    if action_type != 'abdominal_crunch':
        return {'status': 'not_applicable', 'compatible': True}

    config = threshold_config if isinstance(threshold_config, dict) else {}
    metadata = config.get('_meta') if isinstance(config.get('_meta'), dict) else {}
    actual_schema = metadata.get('feature_schema_version')
    schema_status = ('missing' if not actual_schema else
                     'match' if actual_schema == ABDOMINAL_POSE_FEATURE_SCHEMA else 'mismatch')
    mismatched_units = {}
    for code, expected in ABDOMINAL_POSE_UNITS.items():
        feature = config.get(code)
        actual = feature.get('unit') if isinstance(feature, dict) else None
        if actual != expected:
            mismatched_units[code] = {'expected': expected, 'actual': actual}

    compatible = schema_status == 'match' and not mismatched_units
    return {
        'status': 'compatible' if compatible else 'incompatible',
        'compatible': compatible,
        'expected_schema': ABDOMINAL_POSE_FEATURE_SCHEMA,
        'actual_schema': actual_schema,
        'schema_status': schema_status,
        'mismatched_units': mismatched_units,
    }
