"""PROTOTYPE — 一条命令试算 447 的准备/顶点/回位；不会保存或改写正式报告。"""

import json
import sys
from pathlib import Path

import numpy as np

from app.core.config import settings
from app.core.models import Frame, Keypoint
from app.core.phase_segmenter import PhaseSegmenter
from app.core.preprocessor import DataPreprocessor
from app.core.prototype_pelvic_447_logic import evaluate_pelvic_evidence


def knee_angle(frame: Frame, side: str) -> float:
    points = [frame.keypoints.get(f'{side}_{part}') for part in ('HIP', 'KNEE', 'ANKLE')]
    if any(point is None or point.visibility < 0.6 for point in points):
        return float('nan')
    hip, knee, ankle = points
    upper = np.array([hip.x - knee.x, hip.y - knee.y])
    lower = np.array([ankle.x - knee.x, ankle.y - knee.y])
    return float(np.degrees(np.arccos(np.clip(
        np.dot(upper, lower) / (np.linalg.norm(upper) * np.linalg.norm(lower)), -1, 1,
    ))))


def load_447():
    source = (Path(settings.local_storage_root) / settings.oss_bucket / 'keypoints' / '447.json')
    payload = json.loads(source.read_text(encoding='utf-8'))
    frames = [Frame(
        frame_index=item['frame_index'], timestamp=item['timestamp'],
        keypoints={name: Keypoint(**point) for name, point in item['keypoints'].items()},
        hip_mid=tuple(item['hip_mid']), shoulder_mid=tuple(item['shoulder_mid']),
    ) for item in payload['frames']]
    frames = DataPreprocessor().run_full_pipeline(frames)
    segmenter = PhaseSegmenter(sample_fps=payload['effective_sample_fps'])
    legacy = segmenter.segment_with_diagnostics(frames, 'pelvic_tilt')
    windows = [(round(frames[rep.start_frame].timestamp, 1),
                round(frames[rep.end_frame].timestamp, 1)) for rep in legacy.reps]
    return (
        np.array([frame.timestamp for frame in frames]),
        segmenter._extract_signal(frames, 'pelvic_tilt'),
        np.array([knee_angle(frame, 'LEFT') for frame in frames]),
        np.array([knee_angle(frame, 'RIGHT') for frame in frames]),
        windows,
    )


def render(data, stable_range: float, recovery_required: float):
    times, signal, left_knee, right_knee, legacy_windows = data
    estimate = evaluate_pelvic_evidence(
        times, signal, left_knee, right_knee,
        stable_range_deg=stable_range, recovery_required=recovery_required,
    )
    if sys.stdout.isatty():
        print('\033[2J\033[H', end='')
    print('\033[1mPROTOTYPE · 视频 447 骨盆倾斜切分对照\033[0m')
    print('人工参考    0–7 秒准备 | 7 秒开始 | 12–15 秒顶点 | 约 20 秒回正 | 1 次')
    print(f'当前正式    {len(legacy_windows)} 次，边界 {legacy_windows}；现有 98.3 分不可据此采信')
    print('\n\033[1m姿态证据试算（不写数据库、不生成评分）\033[0m')
    for label, key, unit in (
        ('稳定姿势就绪', 'ready_time', '秒'),
        ('就绪角度基线', 'baseline_angle', '°'),
        ('首个显著顶点', 'peak_time', '秒'),
        ('顶点角度变化', 'peak_amplitude', '°'),
        ('最接近基线', 'best_return_time', '秒'),
        ('最大回位比例', 'recovery_fraction', '%'),
        ('20 秒回位比例', 'recovery_at_20s', '%'),
    ):
        value = estimate[key]
        shown = '未识别' if value is None else (f'{value:.0%}' if unit == '%' else str(value) + unit)
        print(f'  {label:<12} {shown}')
    verdict = '1 次完整周期候选' if estimate['complete'] else '可见动作候选；回位证据不足，不能自动出分'
    print(f'\n判断        {verdict}')
    print(f'阈值        稳定角度范围 ≤{stable_range:.2f}°；回位比例 ≥{recovery_required:.0%}')
    print('\n[s] 放宽稳定角度  [S] 收紧  [r] 放宽回位  [R] 收紧  [q] 退出')
    return estimate


def main():
    data = load_447()
    stable_range = 0.45
    recovery_required = 0.70
    while True:
        render(data, stable_range, recovery_required)
        if not sys.stdin.isatty():
            break
        command = input('选择> ').strip()
        if command == 'q':
            break
        if command == 's':
            stable_range = min(2.0, stable_range + 0.1)
        elif command == 'S':
            stable_range = max(0.1, stable_range - 0.1)
        elif command == 'r':
            recovery_required = max(0.1, recovery_required - 0.1)
        elif command == 'R':
            recovery_required = min(1.0, recovery_required + 0.1)


if __name__ == '__main__':
    main()
