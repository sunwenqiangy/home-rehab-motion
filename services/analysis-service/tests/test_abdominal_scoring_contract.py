"""缩腹评分只把同口径模板视为可比较。"""

from app.core.scoring_contract import assess_scoring_contract
from app.tasks.analyze_video import _requires_abdominal_template_review


def test_legacy_percentage_template_cannot_validate_angle_features() -> None:
    assessment = assess_scoring_contract('abdominal_crunch', {
        '_meta': {},
        'abdominal_displacement': {'unit': '%'},
        'displacement_velocity': {'unit': '%/s'},
        'hold_duration': {'unit': 's'},
        'trunk_angle_change': {'unit': 'deg'},
    })
    assert not assessment['compatible']
    assert assessment['expected_schema'] == 'abdominal_pose_v2'
    assert assessment['mismatched_units'] == {
        'abdominal_displacement': {'expected': 'deg', 'actual': '%'},
        'displacement_velocity': {'expected': 'deg/s', 'actual': '%/s'},
    }
    assert assessment['schema_status'] == 'missing'


def test_matching_versioned_template_is_comparable() -> None:
    assessment = assess_scoring_contract('abdominal_crunch', {
        '_meta': {'feature_schema_version': 'abdominal_pose_v2'},
        'abdominal_displacement': {'unit': 'deg'},
        'displacement_velocity': {'unit': 'deg/s'},
        'hold_duration': {'unit': 's'},
        'trunk_angle_change': {'unit': 'deg'},
    })
    assert assessment['compatible']
    assert assessment['mismatched_units'] == {}
    assert assessment['schema_status'] == 'match'


def test_other_actions_are_not_changed_by_abdominal_contract() -> None:
    assert assess_scoring_contract('pelvic_tilt', {})['status'] == 'not_applicable'


def test_admin_flow_keeps_diagnostic_score_while_patient_requires_compatible_template() -> None:
    assert not _requires_abdominal_template_review('abdominal_crunch', 'admin_flow_verify', False)
    assert _requires_abdominal_template_review('abdominal_crunch', 'miniapp', False)
    assert _requires_abdominal_template_review('abdominal_crunch', 'gold_template', False)
    assert not _requires_abdominal_template_review('abdominal_crunch', 'miniapp', True)
    assert not _requires_abdominal_template_review('pelvic_tilt', 'miniapp', False)
