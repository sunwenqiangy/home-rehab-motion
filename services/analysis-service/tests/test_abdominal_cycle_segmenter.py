import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.models import CompareResult, Frame, Keypoint, Rep, RepScore, SegmentationCandidate, SegmentationResult
from app.core.phase_segmenter import PhaseSegmenter
from app.core.scoring import ScoringEngine, generate_advice
from app.core.preprocessor import DataPreprocessor, KeypointQualityError
from app.core.config import Settings
from app.tasks.analyze_video import _build_segmentation_snapshot, _resolve_pose_sampling


def _signal_from_cycles(fps, cycles, duration=32):
    """基于秒构造稳定-收缩-顶点-回落-稳定信号。

    cycles: [(rest_start_s, peak_s, return_s, amplitude), ...]
      - rest_start_s: 静息起始（秒）
      - peak_s: 收缩顶点（秒）
      - return_s: 回落完成（秒）
      - amplitude: 峰值幅度
    信号在 rest_start→peak 线性上升，peak→return 线性下降。
    """
    signal = np.zeros(int(duration * fps), dtype=float)
    for start, peak, returned, amplitude in cycles:
        start_i, peak_i, end_i = (round(value * fps) for value in (start, peak, returned))
        signal[start_i:peak_i + 1] += np.linspace(0, amplitude, peak_i - start_i + 1)
        signal[peak_i:end_i + 1] += np.linspace(amplitude, 0, end_i - peak_i + 1)
    return signal


def _run(signal, fps):
    return PhaseSegmenter(sample_fps=fps)._segment_abdominal_cycle_state_machine(signal)


def _trunk_frame(index, visibility=1.0):
    keypoints = {
        name: Keypoint(x=float(index), y=1.0, z=0.0, visibility=visibility)
        for name in ('LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP')
    }
    return Frame(frame_index=index, timestamp=index / 5, keypoints=keypoints)


# ─── 姿态采样策略 ───────────────────────────────────────────────────────


def test_pelvic_tilt_uses_four_fps_timestamp_sampling_by_default():
    """骨盆倾斜线上默认保持 4fps，且按时间戳抽样。"""
    assert _resolve_pose_sampling('pelvic_tilt', None) == (4, True)


@pytest.mark.parametrize('requested_fps', [4, 6, 10])
def test_pelvic_tilt_honors_requested_sampling_rate_for_comparison(requested_fps):
    """回归对比时，骨盆倾斜可明确以指定帧率进行关键点采样。"""
    assert _resolve_pose_sampling('pelvic_tilt', requested_fps) == (requested_fps, True)


def test_other_actions_keep_requested_or_default_sampling():
    assert _resolve_pose_sampling('abdominal_crunch', None) == (10, False)
    assert _resolve_pose_sampling('knee_rotation', 8) == (8, False)


def test_default_frame_budget_covers_longest_fixed_fps_pelvic_video():
    """未通过 Compose 注入配置时，默认预算也须覆盖 300 秒×4fps。"""
    default_settings = Settings(_env_file=None)
    pose_fps, _ = _resolve_pose_sampling('pelvic_tilt', None)
    assert default_settings.max_analysis_frames >= default_settings.max_analysis_duration_seconds * pose_fps


# ─── 骨盆倾斜时间归一切分 ───────────────────────────────────────────────


def test_pelvic_tilt_logical_timeline_matches_online_default_sampling():
    """切分逻辑轴固定为线上默认 4fps，避免改变已验证的十次动作口径。"""
    assert PhaseSegmenter._PELVIC_SEGMENTATION_FPS == 4.0


def _pelvic_frames_from_signal(signal, fps):
    """将合成躯干倾角序列转换为骨盆倾斜切分所需的关键点帧。"""
    frames = []
    for index, angle in enumerate(signal):
        radians = np.radians(angle)
        frames.append(Frame(
            frame_index=index,
            timestamp=index / fps,
            keypoints={},
            hip_mid=(0.0, 0.0, 0.0),
            shoulder_mid=(float(np.sin(radians)), float(-np.cos(radians)), 0.0),
        ))
    return frames


def test_pelvic_tilt_count_is_stable_when_source_sampling_rate_changes():
    """同一真实时间信号即使姿态帧率下降，也必须得到一致的完整动作次数。"""
    cycles = [(2, 7, 14, 4.0), (18, 23, 30, 4.0), (34, 39, 46, 4.0)]
    counts = []
    for fps in (3, 4, 6, 10):
        signal = _signal_from_cycles(fps, cycles, duration=52)
        frames = _pelvic_frames_from_signal(signal, fps)
        result = PhaseSegmenter(sample_fps=fps).segment_with_diagnostics(frames, 'pelvic_tilt')
        counts.append(len(result.reps))
        assert result.version == 'pelvic_tilt_time_v3'
    assert counts == [3, 3, 3, 3]


def test_pelvic_tilt_counts_ten_compact_complete_cycles_at_every_sampling_rate():
    """标准教学节奏的十个完整后倾—回正周期不得因抽帧率或中间短暂静止被合并。"""
    cycles = [
        (1 + index * 12, 5 + index * 12, 10 + index * 12, 4.0)
        for index in range(10)
    ]
    counts = []
    for fps in (4, 6, 10):
        signal = _signal_from_cycles(fps, cycles, duration=125)
        frames = _pelvic_frames_from_signal(signal, fps)
        result = PhaseSegmenter(sample_fps=fps).segment_with_diagnostics(frames, 'pelvic_tilt')
        counts.append(len(result.reps))
        assert result.version == 'pelvic_tilt_time_v3'
    assert counts == [10, 10, 10]


def test_pelvic_tilt_counts_complete_eight_second_cycles():
    """连续完成的约八秒骨盆倾斜周期应逐次计数，不应再被十秒阈值过滤。"""
    cycles = [
        (1 + index * 9, 4 + index * 9, 8 + index * 9, 4.0)
        for index in range(10)
    ]
    signal = _signal_from_cycles(4, cycles, duration=96)
    frames = _pelvic_frames_from_signal(signal, 4)

    result = PhaseSegmenter(sample_fps=4).segment_with_diagnostics(frames, 'pelvic_tilt')

    assert len(result.reps) == 10


def test_pelvic_tilt_rejects_complete_cycles_shorter_than_eight_seconds():
    """不足八秒的往返不作为独立训练动作，避免把调整或抖动记为次数。"""
    signal = _signal_from_cycles(4, [(1, 3, 7, 4.0)], duration=12)
    frames = _pelvic_frames_from_signal(signal, 4)

    result = PhaseSegmenter(sample_fps=4).segment_with_diagnostics(frames, 'pelvic_tilt')

    assert result.reps == []


def test_pelvic_tilt_keeps_native_four_fps_signal_without_reinterpolation(monkeypatch):
    """规范 4fps 输入不应二次插值，避免在真实峰谷边界引入数值漂移。"""
    signal = _signal_from_cycles(4, [(2, 7, 14, 4.0), (18, 23, 30, 4.0)], duration=34)
    frames = _pelvic_frames_from_signal(signal, 4)
    monkeypatch.setattr(np, 'interp', lambda *_: pytest.fail('native 4fps should not be reinterpolated'))
    assert len(PhaseSegmenter(sample_fps=4).segment_with_diagnostics(frames, 'pelvic_tilt').reps) == 2


def test_pelvic_stability_window_rejects_a_short_pause_inside_return_motion():
    """稳定中立位需要覆盖谷值前后，以免回正中的短暂停顿被误计成新动作。"""
    signal = np.array([0.0, 0.04, 0.07, 0.11, 0.41, 0.72], dtype=float)
    assert not PhaseSegmenter._is_stable_pelvic_baseline(signal, 2, 3, 0.15)


# ─── 单向评分连续性 ──────────────────────────────────────────────────────


def test_directional_normal_scores_distinguish_threshold_from_reference_target():
    """刚达标的保持时间不能与接近模板目标的动作同为 100 分。"""
    engine = ScoringEngine()
    threshold_rep = engine.score_rep(
        1,
        [CompareResult(
            feature_code='hold_duration', measured=0.31, reference_mean=1.6,
            reference_std=0.65, deviation_sigma=0, label='normal', in_valid_range=True,
            scoring_mode='lower_bound', normal_threshold=0.31,
        )],
        'pelvic_tilt',
    )
    target_rep = engine.score_rep(
        2,
        [CompareResult(
            feature_code='hold_duration', measured=1.6, reference_mean=1.6,
            reference_std=0.65, deviation_sigma=0, label='normal', in_valid_range=True,
            scoring_mode='lower_bound', normal_threshold=0.31,
        )],
        'pelvic_tilt',
    )

    assert threshold_rep.duration_score == 85
    assert target_rep.duration_score == 100
    assert threshold_rep.total_score < target_rep.total_score


# ─── 视频级建议聚合 ─────────────────────────────────────────────────────


def _rep_score_with_issues(rep_id, issues=None):
    return RepScore(
        rep_id=rep_id,
        accuracy_score=95,
        stability_score=95,
        control_score=95,
        duration_score=95,
        total_score=95,
        grade='优秀',
        valid_flag=True,
        compensation_types=issues or [],
    )


def test_advice_ignores_a_single_warning_in_an_otherwise_stable_video():
    """8 次动作中只有 1 次轻微波动，不应被泛化为整段训练的问题。"""
    rep_scores = [_rep_score_with_issues(1, ['trunk_angle_change'])]
    rep_scores.extend(_rep_score_with_issues(rep_id) for rep_id in range(2, 9))

    main_issues, advice_summary = generate_advice(rep_scores, confidence_score=0.9)

    assert main_issues == []
    assert advice_summary == []


def test_advice_surfaces_a_recurrent_warning_with_patient_friendly_copy():
    """相同问题在多次动作中重复出现时，才展示专项纠正建议。"""
    rep_scores = [
        _rep_score_with_issues(1, ['trunk_angle_change']),
        _rep_score_with_issues(2, ['trunk_angle_change']),
        *[_rep_score_with_issues(rep_id) for rep_id in range(3, 9)],
    ]

    main_issues, advice_summary = generate_advice(rep_scores, confidence_score=0.9)

    assert main_issues == [{'feature': 'trunk_angle_change', 'label': 'warning'}]
    assert advice_summary == [{
        'advice_code': 'ADV_TRUNK_STABILITY',
        'patient_text': '上身有些晃动。下次可轻轻收紧腹部，让躯干尽量保持稳定。',
        'nurse_text': 'trunk_angle_change 在多次动作中偏高，可能存在躯干代偿',
    }]


# ─── 关键点质量门禁 ─────────────────────────────────────────────────────


def test_unstable_trunk_keypoints_expose_structured_admin_diagnostics():
    """关键躯干点不足应保留结构化诊断，而非将可用率误作患者画面缺失比例。"""
    frames = [_trunk_frame(index, visibility=1.0 if index < 6 else 0.0) for index in range(10)]

    with pytest.raises(KeypointQualityError) as captured:
        DataPreprocessor().validate_required_keypoints(frames)

    error = captured.value
    assert '未能稳定识别' in str(error)
    assert error.valid_ratio == 0.6
    assert error.quality_issues == [{
        'code': 'TRUNK_KEYPOINTS_UNSTABLE',
        'scope': 'trunk',
        'valid_frame_ratio': 0.6,
        'required_ratio': 0.7,
        'affected_keypoints': ['LEFT_SHOULDER', 'RIGHT_SHOULDER', 'LEFT_HIP', 'RIGHT_HIP'],
    }]


# ─── 反弹（REBOUND）测试 ────────────────────────────────────────────────


def test_rebound_is_rejected_without_extra_rep():
    """回落阶段的局部反弹必须被标记为 REBOUND，不能产生第二个周期。

    信号构造：一个完整周期 2s→5s→8s(amplitude=2.0)，随后在回落中途
    叠加一个足够大的反弹脉冲，使状态机进入 RETURNING 后检测到上升
    （signal[i+1]-signal[i] > trend_delta），但反弹独立幅度 < rebound_limit。
    """
    fps = 5
    signal = _signal_from_cycles(fps, [(2, 5, 8, 2.0)], duration=14)
    # 在回落中段(帧31=6.2s)注入明显反弹：帧31→32 上升 0.4，帧32→33 上升 0.3，
    # 随后继续回落。反弹总幅度 0.7 > trend_delta(≈0.02) 触发反弹检测，
    # 但独立幅度 < rebound_limit(robust_range*0.20≈0.35)，所以应被标记为 REBOUND。
    # 注意：叠加后帧31的值不能超过前一个局部高点。
    # 原始帧30: 1.33, 帧31: 1.20, 帧32: 1.07, 帧33: 0.93
    # 叠加: 帧31: 1.20+0.0=1.20, 帧32: 1.07+0.40=1.47, 帧33: 0.93+0.30=1.23
    # 帧34: 0.80+0.0=0.80 — 反弹在帧32达峰1.47，之后回落
    signal[31] += 0.0
    signal[32] += 0.40
    signal[33] += 0.30
    signal[34] += 0.0
    result = _run(signal, fps)
    assert len(result.reps) == 1
    assert any(item.state == 'REBOUND' for item in result.rejected_candidates), (
        f'Expected REBOUND in rejected, got: {result.rejected_candidates}'
    )


# ─── 低幅度完整周期 ──────────────────────────────────────────────────────


def test_low_prominence_complete_cycle_is_counted():
    """低幅度但完整闭环的周期应该被正确计数。

    信号构造：一个完整周期 2s→5s→8s(amplitude=0.8)。
    周期时长 6s > min_cycle_seconds(3.5s)，幅度 0.8 > candidate_floor。
    """
    fps = 5
    # amplitude=0.8: robust_range ≈ 0.7, candidate_floor ≈ 0.21
    # 周期幅度 peak-start ≈ 0.8 > candidate_floor，时长 6s > 3.5s
    signal = _signal_from_cycles(fps, [(2, 5, 8, 0.8)], duration=14)
    result = _run(signal, fps)
    assert len(result.reps) == 1, (
        f'Expected 1 rep, got {len(result.reps)}; '
        f'accepted={result.accepted_cycles}, rejected={result.rejected_candidates}'
    )
    assert result.accepted_cycles[0].state == 'COMPLETE'


# ─── 尾部截断（INCOMPLETE_TAIL）测试 ────────────────────────────────────


def test_tail_cycle_is_accepted_with_explicit_reason():
    """视频末尾的周期稳定窗口被截断，应标记为 INCOMPLETE_TAIL。

    信号构造：第一个周期完整(2→5→8s)，第二个周期的回落刚完成但
    没有足够的稳定帧（视频在回落完成后1帧就结束），因此尾部周期
    只能通过"视频结束"分支处理，标记为 INCOMPLETE_TAIL。
    """
    fps = 5
    # 第二个周期: 11→14→16.5s, 回落在帧82.5完成
    # duration=17s → 帧85; 尾部只剩85-82=3帧
    # 但 stable_frames=3，3帧刚好够 is_stable 检测
    # 缩短 duration 到 16.8s=帧84，尾部只剩84-82=2帧 < stable_frames(3)
    signal = _signal_from_cycles(fps, [(2, 5, 8, 1.6), (11, 14, 16.5, 1.5)], duration=16.8)
    result = _run(signal, fps)
    assert len(result.reps) == 2, (
        f'Expected 2 reps, got {len(result.reps)}; '
        f'accepted={result.accepted_cycles}, rejected={result.rejected_candidates}'
    )
    assert result.accepted_cycles[-1].state == 'INCOMPLETE_TAIL', (
        f'Expected INCOMPLETE_TAIL, got {result.accepted_cycles[-1].state}'
    )
    assert '截断' in result.accepted_cycles[-1].reason


# ─── 噪声拒绝 ────────────────────────────────────────────────────────────


def test_noise_is_not_a_cycle():
    rng = np.random.default_rng(7)
    result = _run(rng.normal(0, 0.03, 150), 5)
    assert result.reps == []


# ─── 多 FPS 一致性 ───────────────────────────────────────────────────────


@pytest.mark.parametrize('fps', [3, 5, 10])
def test_time_semantics_are_consistent_across_effective_sample_rates(fps):
    signal = _signal_from_cycles(fps, [(2, 5, 8, 1.4), (11, 14, 17, 1.2), (20, 23, 26, 1.5)], duration=31)
    assert len(_run(signal, fps).reps) == 3


# ─── Legacy 峰值切分不中断 ───────────────────────────────────────────────


def test_legacy_peak_is_available_unchanged():
    signal = _signal_from_cycles(5, [(2, 5, 8, 1.5), (11, 14, 17, 1.5)], duration=22)
    segmenter = PhaseSegmenter(sample_fps=5)
    legacy = segmenter._segment_abdominal_reps(signal)
    assert len(legacy) == 2
    assert segmenter._segment_abdominal_cycle_state_machine(signal).version == 'abdominal_cycle_v3'


def test_cycle_waits_for_confirmed_return_before_closing_rep():
    """缓慢回正中出现短暂平缓不能提前闭合为一次动作。"""
    fps = 5
    # 2s 开始收缩、5s 到顶；5~9s 缓慢回正，其中 6.2~6.8s 近乎平坦。
    # 若不等待 return_end，平坦段会在回正途中被误当成稳定中立。
    signal = np.zeros(int(14 * fps), dtype=float)
    signal[10:26] = np.linspace(0, 2.0, 16)
    signal[26:46] = np.linspace(2.0, 0, 20)
    signal[31:35] = signal[31]
    result = _run(signal, fps)

    assert len(result.reps) == 1
    accepted = result.accepted_cycles[0]
    assert accepted.return_frame is not None
    assert accepted.stable_frame is not None
    assert accepted.stable_frame >= accepted.return_frame


# ─── PEAK→CONTRACTING 回退（局部峰后继续上升） ──────────────────────────


def test_local_peak_within_contraction_is_overshot():
    """收缩过程中的局部峰只应被跳过，真正的最高点才是周期顶点。

    信号构造：2s→3.5s 上升 0.6，3.5s→4.5s 小幅回落 0.15（局部峰），
    4.5s→6s 继续上升至幅度 1.4，6s→9s 回落至基线，9s→12s 稳定。
    """
    fps = 5
    signal = _signal_from_cycles(fps, [(2, 6, 9, 1.4)], duration=13)
    # 在帧 17 (3.4s) 注入局部回落再回升：制造一个"局部峰"
    # 原始帧 15-20 大约是线性上升区，在帧 17 注入一个小谷
    # 让信号[17] 低于两侧，形成局部峰在帧 16 和 18
    signal[17] -= 0.15
    result = _run(signal, fps)
    assert len(result.reps) == 1, (
        f'Expected 1 rep, got {len(result.reps)}; '
        f'accepted={result.accepted_cycles}, rejected={result.rejected_candidates}'
    )
    # 峰值应在真正的全局顶点附近，而非局部峰
    assert result.accepted_cycles[0].peak_frame > 17


# ─── 尾部周期 trough-based 幅度 ─────────────────────────────────────────


def test_tail_cycle_uses_trough_based_amplitude():
    """尾部周期的幅度应基于周期内谷值，而非上一个周期的 start。

    信号构造：第一周期 2→5→8s(amplitude=1.5)，回落完成后信号停在约 0.3
    （高于 0），然后在 11→14→16.5s 开始第二周期，幅度 1.2。
    视频在回落完成后 1 帧结束，使第二周期进入 INCOMPLETE_TAIL 分支。
    如果用 start=8（值为 0.3）算幅度会低估，但 trough 应在 11s（≈0.3），
    使 amplitude ≈ 1.2，超过 candidate_floor。
    """
    fps = 5
    signal = _signal_from_cycles(fps, [(2, 5, 8, 1.5), (11, 14, 16.5, 1.2)], duration=16.8)
    result = _run(signal, fps)
    assert len(result.reps) == 2, (
        f'Expected 2 reps, got {len(result.reps)}; '
        f'accepted={result.accepted_cycles}, rejected={result.rejected_candidates}'
    )
    tail = result.accepted_cycles[-1]
    assert tail.state == 'INCOMPLETE_TAIL'
    # trough-based 幅度应接近 1.2，远大于 candidate_floor
    assert tail.amplitude > 0.8, f'Tail amplitude too low: {tail.amplitude}'


# ─── Shadow 诊断快照 ─────────────────────────────────────────────────────


def test_shadow_snapshot_keeps_legacy_as_formal_and_records_cycle_evidence():
    """Shadow 仅记录闭环结果，正式次数和版本必须仍来自旧峰值切分。"""
    legacy = SegmentationResult(
        version='abdominal_peak_v1',
        reps=[Rep(id=1, start_frame=2, end_frame=12)],
    )
    cycle = SegmentationResult(
        version='abdominal_cycle_v3',
        reps=[Rep(id=1, start_frame=2, end_frame=12), Rep(id=2, start_frame=16, end_frame=29)],
        accepted_cycles=[
            SegmentationCandidate(
                state='COMPLETE',
                start_frame=2,
                peak_frame=7,
                return_frame=10,
                stable_frame=12,
                amplitude=0.82345,
                reason='完成稳定-收缩-顶点-回落-稳定闭环',
            ),
        ],
        rejected_candidates=[
            SegmentationCandidate(
                state='REBOUND',
                start_frame=14,
                peak_frame=15,
                amplitude=0.10999,
                reason='回落未稳定前的局部反弹，独立幅度不足',
            ),
        ],
    )

    snapshot = _build_segmentation_snapshot(
        action_type='abdominal_crunch',
        mode='shadow',
        effective_sample_fps=4.0,
        legacy_result=legacy,
        cycle_result=cycle,
        legacy_segment_ms=3,
        cycle_segment_ms=5,
        frame_timestamps={2: 0.5, 7: 1.75, 10: 2.5, 12: 3.0, 14: 3.5, 15: 3.75},
    )

    assert snapshot['formal_version'] == 'abdominal_peak_v1'
    assert snapshot['formal_rep_count'] == 1
    assert snapshot['legacy_rep_count'] == 1
    assert snapshot['cycle_rep_count'] == 2
    assert snapshot['count_delta'] == 1
    assert snapshot['timings_ms']['shadow_overhead_ms'] == 5
    assert snapshot['accepted_cycles'][0]['amplitude'] == 0.8235
    assert snapshot['accepted_cycles'][0]['start_time'] == 0.5
    assert snapshot['accepted_cycles'][0]['peak_time'] == 1.75
    assert snapshot['accepted_cycles'][0]['return_time'] == 2.5
    assert snapshot['accepted_cycles'][0]['stable_time'] == 3.0
    assert snapshot['rejected_candidates'][0]['state'] == 'REBOUND'
    assert snapshot['rejected_candidates'][0]['start_time'] == 3.5
    assert snapshot['rejected_candidates'][0]['peak_time'] == 3.75


def test_legacy_snapshot_skips_cycle_diagnostics_for_non_shadow_run():
    """未运行闭环状态机时，不得伪造次数差或候选诊断。"""
    legacy = SegmentationResult(version='abdominal_peak_v1', reps=[])

    snapshot = _build_segmentation_snapshot(
        action_type='abdominal_crunch',
        mode='legacy_peak',
        effective_sample_fps=5.0,
        legacy_result=legacy,
        cycle_result=None,
        legacy_segment_ms=2,
        cycle_segment_ms=0,
    )

    assert snapshot['formal_version'] == 'abdominal_peak_v1'
    assert snapshot['formal_rep_count'] == 0
    assert snapshot['shadow_skipped_reason'] == '非缩腹动作或未启用闭环切分'
    assert 'count_delta' not in snapshot
