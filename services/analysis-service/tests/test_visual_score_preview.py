"""流程验证中的视觉边界试算不得伪装成正式评分。"""

from app.core.models import Frame, Rep
from app.core.scoring_preview import preview_abdominal_reps


def _frames() -> list[Frame]:
    offsets = [0.0] * 5 + [0.01 * i for i in range(1, 11)] + [0.1] * 5 + [0.1 - 0.01 * i for i in range(1, 11)] + [0.0] * 5
    return [Frame(index, index / 10, {}, hip_mid=(0.0, 0.0, 0.0),
                  shoulder_mid=(offset, 1.0, 0.0)) for index, offset in enumerate(offsets)]


def test_visual_preview_scores_only_supplied_complete_cycles_and_marks_legacy_template_provisional() -> None:
    preview = preview_abdominal_reps(
        _frames(), [Rep(1, 5, 29)], sample_fps=10,
        reference_stats={
            'abdominal_displacement': {'mean': 3.0, 'std': 1.0},
            'displacement_velocity': {'mean': 1.0, 'std': 0.5},
            'hold_duration': {'mean': 0.5, 'std': 0.2},
            'trunk_angle_change': {'mean': 3.0, 'std': 1.0},
        },
        threshold_config={
            'abdominal_displacement': {'unit': '%'},
            'displacement_velocity': {'unit': '%/s'},
            'hold_duration': {'unit': 's'},
            'trunk_angle_change': {'unit': 'deg'},
        },
    )
    assert preview['candidate_count'] == 1
    assert not preview['template_comparable']
    assert preview['score_status'] == 'provisional_incompatible_template'
    assert len(preview['reps']) == 1
    assert preview['reps'][0]['start_time'] == 0.5
    assert preview['reps'][0]['end_time'] == 2.9
    assert isinstance(preview['reps'][0]['score'], float)
