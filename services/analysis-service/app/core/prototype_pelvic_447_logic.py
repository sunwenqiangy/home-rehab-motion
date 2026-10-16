"""PROTOTYPE — 验证骨盆倾斜的准备、顶点、回位证据，不用于正式计次评分。

问题：447 人工标为 7 秒开始、12～15 秒顶点、20 秒回正；现有姿态信号
能否独立重现这些边界？输入是已提取的关键点时间序列，输出仅为试算证据。
"""

from typing import Dict, Optional

import numpy as np
from scipy.signal import find_peaks


def evaluate_pelvic_evidence(
    times: np.ndarray,
    torso_angle: np.ndarray,
    left_knee: np.ndarray,
    right_knee: np.ndarray,
    *,
    stable_range_deg: float = 0.45,
    recovery_required: float = 0.70,
) -> Dict[str, Optional[float]]:
    """纯试算：先找稳定屈膝姿势，再找首个显著摆幅及其回位比例。"""
    smoothed = np.convolve(torso_angle, np.ones(5) / 5, mode='same')
    smoothed[:2] = torso_angle[:2]
    smoothed[-2:] = torso_angle[-2:]
    result: Dict[str, Optional[float]] = {
        'ready_time': None, 'baseline_angle': None, 'peak_time': None,
        'peak_amplitude': None, 'best_return_time': None,
        'recovery_fraction': None, 'recovery_at_20s': None,
        'complete': False,
    }
    if len(times) < 12:
        return result

    ready_index = None
    for index in range(len(times)):
        window = np.flatnonzero((times >= times[index]) & (times <= times[index] + 1.5))
        if len(window) < 5 or times[window[-1]] - times[index] < 1.25:
            continue
        if (np.all(left_knee[window] <= 110) and np.all(right_knee[window] <= 110)
                and np.ptp(smoothed[window]) <= stable_range_deg):
            ready_index = int(window[-1])
            result['ready_time'] = round(float(times[ready_index]), 2)
            result['baseline_angle'] = round(float(np.median(smoothed[window])), 2)
            break
    if ready_index is None:
        return result

    baseline = float(result['baseline_angle'])
    fps = (len(times) - 1) / max(float(times[-1] - times[0]), 1e-6)
    start = int(np.searchsorted(times, times[ready_index] + 2.0))
    # 骨盆运动在不同镜头中可能表现为角度上升或下降，两个极性都试算。
    candidates = []
    for polarity in (-1.0, 1.0):
        excursion = polarity * (smoothed - baseline)
        peaks, properties = find_peaks(
            excursion, prominence=0.8, distance=max(1, int(3 * fps)),
        )
        for peak, prominence in zip(peaks, properties['prominences']):
            if peak >= start and excursion[peak] >= 1.8 and prominence >= 0.8:
                candidates.append((int(peak), float(excursion[peak]), polarity))
    if not candidates:
        return result
    peak_index, amplitude, polarity = min(candidates, key=lambda item: item[0])
    result['peak_time'] = round(float(times[peak_index]), 2)
    result['peak_amplitude'] = round(amplitude, 2)

    after_peak = np.flatnonzero((times >= times[peak_index] + 1.0)
                                 & (times <= times[peak_index] + 8.0))
    if len(after_peak):
        deviation = np.abs(smoothed[after_peak] - baseline)
        best = int(after_peak[int(np.argmin(deviation))])
        recovered = 1.0 - float(abs(smoothed[best] - baseline)) / amplitude
        result['best_return_time'] = round(float(times[best]), 2)
        result['recovery_fraction'] = round(max(0.0, recovered), 2)
        result['complete'] = bool(recovered >= recovery_required)
    at_20 = int(np.argmin(np.abs(times - 20.0)))
    result['recovery_at_20s'] = round(
        max(0.0, 1.0 - float(abs(smoothed[at_20] - baseline)) / amplitude), 2,
    )
    return result
