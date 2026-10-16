"""视觉影子诊断既覆盖患者短片段，也覆盖同素材的后台流程验证。"""

from app.tasks.analyze_video import _uses_visual_practice, _should_run_visual_shadow, _visual_analysis_limit_seconds
from app.core.confidence import compute_confidence
from app.core.models import Frame, Keypoint
from app.core.pose_estimator import PoseEstimator
from app.tasks.analyze_video import VISUAL_ANCHOR_KEYPOINTS


def test_visual_shadow_runs_for_short_clip_and_admin_flow_verification() -> None:
    assert _should_run_visual_shadow('abdominal_crunch', 'shadow', True, 'miniapp')
    assert _should_run_visual_shadow('abdominal_crunch', 'shadow', False, 'admin_flow_verify')
    assert _visual_analysis_limit_seconds('miniapp') == 30
    assert _visual_analysis_limit_seconds('admin_flow_verify') == 300
    assert _visual_analysis_limit_seconds(None) == 30


def test_visual_shadow_does_not_affect_other_modes_or_actions() -> None:
    assert not _should_run_visual_shadow('abdominal_crunch', 'legacy_peak', True, 'miniapp')
    assert not _should_run_visual_shadow('abdominal_crunch', 'cycle_state_machine', True, 'miniapp')
    assert not _should_run_visual_shadow('abdominal_crunch', 'shadow', False, 'gold_template')
    assert not _should_run_visual_shadow('pelvic_tilt', 'shadow', True, 'miniapp')


def test_visual_practice_applies_to_every_miniapp_abdominal_clip() -> None:
    assert _uses_visual_practice('abdominal_crunch', 'shadow', True, 'miniapp')
    assert not _uses_visual_practice('abdominal_crunch', 'shadow', True, 'admin_flow_verify')
    assert not _uses_visual_practice('abdominal_crunch', 'shadow', False, 'miniapp')
    assert not _uses_visual_practice('abdominal_crunch', 'legacy_peak', True, 'miniapp')
    assert not _uses_visual_practice('pelvic_tilt', 'shadow', True, 'miniapp')


def test_visual_clip_uses_visible_shoulder_hip_anchors_without_penalizing_missing_knees() -> None:
    frames = [Frame(index, index / 10, {
        name: Keypoint(0.2 + offset, 0.5, 0, 1.0)
        for name, offset in zip(VISUAL_ANCHOR_KEYPOINTS, (0, 0.1, 0.2, 0.3))
    } | {
        'LEFT_KNEE': Keypoint(0.4, 0.8, 0, 0.0),
        'RIGHT_KNEE': Keypoint(0.5, 0.8, 0, 0.0),
    }) for index in range(50)]
    estimator = PoseEstimator()
    old_visibility = estimator.compute_avg_visibility(frames)
    anchor_visibility = estimator.compute_avg_visibility(frames, VISUAL_ANCHOR_KEYPOINTS)
    assert old_visibility < 0.7
    assert anchor_visibility == 1.0
    confidence = compute_confidence(frames, anchor_visibility, 1, 1, short_clip=True,
                                    quality_keypoint_names=VISUAL_ANCHOR_KEYPOINTS)
    assert confidence.level == 'high'
