"""普通视频的次数范围与短片段规则保持独立。"""

from app.tasks.analyze_video import _expected_rep_range


def test_abdominal_crunch_accepts_one_to_twenty_five_reps() -> None:
    minimum, maximum = _expected_rep_range('abdominal_crunch')
    assert (minimum, maximum) == (1, 25)
    assert minimum <= 1 <= maximum
    assert minimum <= 25 <= maximum
    assert not minimum <= 0 <= maximum
    assert not minimum <= 26 <= maximum


def test_other_action_ranges_are_unchanged() -> None:
    assert _expected_rep_range('pelvic_tilt') == (3, 30)
    assert _expected_rep_range('knee_rotation') == (4, 20)
    assert _expected_rep_range('unknown') == (1, 100)


def test_admin_flow_verification_accepts_one_complete_cycle_without_changing_maximums() -> None:
    assert _expected_rep_range('pelvic_tilt', 'admin_flow_verify') == (1, 30)
    assert _expected_rep_range('knee_rotation', 'admin_flow_verify') == (1, 20)
    assert _expected_rep_range('abdominal_crunch', 'admin_flow_verify') == (1, 25)
    assert _expected_rep_range('pelvic_tilt', 'miniapp') == (3, 30)
