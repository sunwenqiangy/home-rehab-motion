"""Step 4: 动作阶段切分"""

import logging
from typing import List, Optional

import numpy as np

from app.core.models import Frame, Rep

logger = logging.getLogger(__name__)


class SegmentationError(Exception):
    """切分阶段失败，附带具体原因供上层透传给用户"""
    pass


class PhaseSegmenter:
    """
    通用切分逻辑：
    1. 计算目标参数的帧间速度（一阶差分）
    2. 速度低于静止阈值 → 静止段
    3. 速度高于运动阈值 → 运动段
    4. 结合动作专家规则识别「有效 rep」边界
    """

    def __init__(self, sample_fps: int = 10):
        self.sample_fps = sample_fps

    # 各动作类型驱动信号的最小有效摆幅（°），低于此说明视频与动作类型不符
    _MIN_SIGNAL_RANGE: dict = {
        'knee_rotation':    15.0,  # 真实膝关节旋转 robust_range 均 ≥39°；<15° 说明几乎无旋转
        'pelvic_tilt':       2.0,  # 骨盆倾斜幅度通常 2~10°；<2° 说明骨盆几乎不动
        'abdominal_crunch':  0.5,  # 缩腹躯干角度变化较小，下限设低
    }

    # 动作类型中文名，用于用户可读的错误提示
    _ACTION_TYPE_NAMES: dict = {
        'knee_rotation':    '膝关节旋转',
        'pelvic_tilt':       '骨盆倾斜',
        'abdominal_crunch':  '缩腹运动',
    }

    def segment(self, frames: List[Frame], action_type: str) -> List[Rep]:
        """按动作类型分发切分逻辑"""
        if not frames:
            return []

        signal = self._extract_signal(frames, action_type)
        if signal is None or len(signal) < 5:
            logger.warning('Signal too short for segmentation: %d frames', len(signal) if signal is not None else 0)
            return []

        # ── 信号幅度合法性校验 ──────────────────────────────────────────────────
        # 使用稳健极差（5%~95%分位数）评估信号摆幅，排除单帧异常影响
        if len(signal) >= 20:
            p5, p95 = float(np.percentile(signal, 5)), float(np.percentile(signal, 95))
            robust_range = p95 - p5
        else:
            robust_range = float(np.ptp(signal))
        min_range = self._MIN_SIGNAL_RANGE.get(action_type, 0.0)
        if robust_range < min_range:
            logger.warning(
                'Signal amplitude too small for %s: robust_range=%.2f° < threshold=%.2f°. '
                'Video may not match action type.',
                action_type, robust_range, min_range,
            )
            raise SegmentationError(
                f'动作信号幅度过低（实测 {robust_range:.1f}°，要求 ≥ {min_range:.1f}°），'
                f'该视频的肢体运动幅度与「{self._ACTION_TYPE_NAMES.get(action_type, action_type)}」不匹配，'
                f'请确认选择了正确的动作类型'
            )
        # ──────────────────────────────────────────────────────────────────────────

        # 移动平均平滑
        smoothed = self._moving_average(signal)

        if action_type == 'abdominal_crunch':
            reps = self._segment_abdominal_reps(smoothed)
            if not reps:
                # 严格完整周期切分失败时，回退到峰值切分，避免直接失败为“未检测到有效动作”。
                # 这里使用更保守的峰值参数，避免把单次动作内抖动切成多个 rep。
                signal_std = float(np.std(smoothed)) if len(smoothed) else 0.0
                signal_range = float(np.max(smoothed) - np.min(smoothed)) if len(smoothed) else 0.0
                fallback_min_distance = max(1, int(2.2 * self.sample_fps))
                fallback_prominence = max(0.4, signal_std * 0.25, signal_range * 0.012)
                relaxed_peaks = self._find_peaks(
                    smoothed,
                    action_type,
                    min_distance_override=fallback_min_distance,
                    prominence_override=fallback_prominence,
                )
                relaxed_troughs = self._find_troughs(
                    smoothed,
                    action_type,
                    min_distance_override=fallback_min_distance,
                    prominence_override=fallback_prominence,
                )
                reps = self._build_reps(
                    relaxed_peaks,
                    smoothed,
                    action_type,
                    troughs=relaxed_troughs,
                )
                reps = self._refine_abdominal_fallback_reps(reps, smoothed, relaxed_troughs)
                logger.info(
                    'Abdominal strict segmentation returned 0 reps, fallback peak-based reps=%d',
                    len(reps),
                )

            logger.info('Segmented %d reps for %s', len(reps), action_type)
            return reps

        if action_type == 'pelvic_tilt':
            # 状态机要求“稳定中立 → 后倾峰值 → 回到稳定中立”闭环；不回退到
            # 普通按峰计数，避免只完成半程或准备姿势也被展示为一次训练。
            reps = self._segment_pelvic_reps(smoothed)
            logger.info('Segmented %d reps for %s', len(reps), action_type)
            return reps

        if action_type == 'knee_rotation':
            reps = self._segment_knee_reps(smoothed)
            if not reps:
                # 回退：放宽 min_distance 到 10s
                signal_std = float(np.std(smoothed)) if len(smoothed) else 0.0
                signal_range = float(np.max(smoothed) - np.min(smoothed)) if len(smoothed) else 0.0
                fallback_min_distance = max(1, int(10.0 * self.sample_fps))
                fallback_prominence = max(0.01, signal_std * 0.3, signal_range * 0.08)
                relaxed_peaks = self._find_peaks(
                    smoothed,
                    action_type,
                    min_distance_override=fallback_min_distance,
                    prominence_override=fallback_prominence,
                )
                reps = self._build_reps(relaxed_peaks, smoothed, action_type)
                logger.info(
                    'Knee strict segmentation returned 0 reps, fallback peak-based reps=%d',
                    len(reps),
                )
            logger.info('Segmented %d reps for %s', len(reps), action_type)
            return reps

        # 其他动作保持原有峰值切分逻辑
        peaks = self._find_peaks(smoothed, action_type)

        if not peaks:
            logger.info('No peaks found for %s', action_type)
            return []

        reps = self._build_reps(peaks, smoothed, action_type)
        logger.info('Segmented %d reps for %s', len(reps), action_type)
        return reps

    def _extract_signal(self, frames: List[Frame], action_type: str) -> Optional[np.ndarray]:
        """提取驱动信号"""
        if action_type == 'abdominal_crunch':
            # 正侧面缩腹的主要变化方向可能落在图像深度 Z 轴；仅使用二维倾角会
            # 把有效收缩动作合并。使用肩中点-髋中点三维向量相对竖直轴的屈曲角。
            signal = []
            for f in frames:
                if f.shoulder_mid is not None and f.hip_mid is not None:
                    dx = f.shoulder_mid[0] - f.hip_mid[0]
                    dy = f.shoulder_mid[1] - f.hip_mid[1]
                    dz = f.shoulder_mid[2] - f.hip_mid[2]
                    angle = np.degrees(np.arctan2(np.hypot(dx, dz), abs(dy) + 1e-8))
                    signal.append(angle)
                else:
                    signal.append(0.0)
            return np.asarray(signal, dtype=float)

        elif action_type == 'pelvic_tilt':
            # 骨盆后倾发生在矢状面。正侧方机位下，以躯干（髋中点→肩中点）
            # 相对竖直方向的有符号倾角作为驱动信号；不能再使用左右髋连线，
            # 后者仅反映正面画面里的左右歪斜，无法代表“腰背贴近垫面”。
            signal = []
            for f in frames:
                if f.shoulder_mid is not None and f.hip_mid is not None:
                    dx = f.shoulder_mid[0] - f.hip_mid[0]
                    dy = f.hip_mid[1] - f.shoulder_mid[1]
                    signal.append(float(np.degrees(np.arctan2(dx, dy))))
                else:
                    signal.append(np.nan)

            values = np.asarray(signal, dtype=float)
            valid = np.isfinite(values)
            if not np.any(valid):
                return None
            # 短暂漏检以最近有效值延续，避免 0 度插入人为的假谷值。
            valid_indexes = np.flatnonzero(valid)
            return np.interp(np.arange(len(values)), valid_indexes, values[valid_indexes])

        elif action_type == 'knee_rotation':
            # 左髋-左膝连线角度（反映屈膝深度与旋转程度）
            # 膝关节旋转动作：屈膝→左旋→回正→右旋→回正，一次完整动作约 20~30s。
            # 左髋膝连线角在屈膝时最大、放平时最小，每次完整动作产生一个清晰的大周期峰，
            # 比 Y 轴坐标对「左右旋转」的区分更稳健，避免把左旋/右旋各算一次。
            signal = []
            for f in frames:
                lh = f.keypoints.get('LEFT_HIP')
                lk = f.keypoints.get('LEFT_KNEE')
                if lh and lk:
                    angle = np.degrees(np.arctan2(lk.y - lh.y, lk.x - lh.x))
                    signal.append(angle)
                else:
                    signal.append(0.0)
            return np.array(signal)

        return None

    def _moving_average(self, signal: np.ndarray, win: Optional[int] = None) -> np.ndarray:
        """移动平均平滑"""
        if win is None:
            win = min(5, max(2, len(signal) // 15))
        if win < 2:
            return signal
        kernel = np.ones(win) / win
        # ``same`` 会隐式用 0 填充首尾。骨盆倾斜角通常在 90° 附近，零填充会
        # 人为制造视频开头/结尾的大幅跳变，进而把准备姿势误识别为一个动作峰。
        # 使用 edge 填充保持首尾姿势连续，再取 valid 区间确保输出长度不变。
        pad_left = win // 2
        pad_right = win - 1 - pad_left
        padded = np.pad(signal, (pad_left, pad_right), mode='edge')
        return np.convolve(padded, kernel, mode='valid')

    def _find_peaks(
        self,
        signal: np.ndarray,
        action_type: str,
        min_distance_override: Optional[int] = None,
        prominence_override: Optional[float] = None,
    ) -> List[int]:
        """极值点检测"""
        try:
            from scipy.signal import find_peaks as scipy_find_peaks
        except ImportError:
            # fallback: 简单极值检测
            return self._simple_peaks(signal)

        min_distance, prominence = self._estimate_peak_params(signal, action_type)
        if min_distance_override is not None:
            min_distance = max(1, int(min_distance_override))
        if prominence_override is not None:
            prominence = max(0.0, float(prominence_override))

        peaks, _ = scipy_find_peaks(signal, distance=min_distance, prominence=prominence)
        return list(peaks)

    def _find_troughs(
        self,
        signal: np.ndarray,
        action_type: str,
        min_distance_override: Optional[int] = None,
        prominence_override: Optional[float] = None,
    ) -> List[int]:
        """谷值点检测（通过对信号取反后找峰）"""
        try:
            from scipy.signal import find_peaks as scipy_find_peaks
        except ImportError:
            inv = -signal
            return self._simple_peaks(inv)

        min_distance, prominence = self._estimate_peak_params(signal, action_type)
        if min_distance_override is not None:
            min_distance = max(1, int(min_distance_override))
        if prominence_override is not None:
            prominence = max(0.0, float(prominence_override))

        troughs, _ = scipy_find_peaks(-signal, distance=min_distance, prominence=prominence)
        return list(troughs)

    def _estimate_peak_params(self, signal: np.ndarray, action_type: str) -> tuple[int, float]:
        """根据动作与信号幅度动态估计峰值检测参数，减少噪声误检。

        使用稳健极差（去掉首尾 5% 分位数）代替全局 max-min，
        避免视频开头/结尾的异常帧把阈值拉高，导致真实动作峰被过滤。
        """
        signal_std = float(np.std(signal)) if len(signal) else 0.0
        # 稳健极差：去掉最高/最低 5% 分位数后的极差，抗异常帧污染
        if len(signal) >= 20:
            p5, p95 = float(np.percentile(signal, 5)), float(np.percentile(signal, 95))
            robust_range = p95 - p5
        else:
            robust_range = float(np.max(signal) - np.min(signal)) if len(signal) else 0.0

        if action_type == 'abdominal_crunch':
            # 标准正侧面缩腹平均周期约 7~14 秒。三维屈曲角可保留每次收缩的
            # 局部峰，3.5 秒仅用于合并同一次动作内的姿态抖动，并非硬编码动作次数。
            min_distance = max(1, int(3.5 * self.sample_fps))
            prominence = max(0.30, signal_std * 0.12, robust_range * 0.12)
        elif action_type == 'knee_rotation':
            # 膝关节旋转：一次完整动作（屈膝+左旋+回正+右旋+回正）约 20~30s
            # 用较大的 min_distance 确保每次完整动作只算一次，不把左旋和右旋分开计
            min_distance = max(1, int(18.0 * self.sample_fps))
            prominence = max(1.0, signal_std * 0.3, robust_range * 0.12)
        elif action_type == 'pelvic_tilt':
            # 骨盆倾斜：侧方机位中，使用躯干—骨盆矢状面倾角寻找完整的收紧峰。
            min_distance = max(1, int(3.5 * self.sample_fps))
            prominence = max(0.35, signal_std * 0.40, robust_range * 0.14)
        else:
            min_distance = max(1, int(2.0 * self.sample_fps))
            prominence = max(0.02, signal_std * 0.3)

        return min_distance, float(prominence)

    def _simple_peaks(self, signal: np.ndarray) -> List[int]:
        """简单极值检测（无 scipy 时的 fallback）"""
        peaks = []
        for i in range(1, len(signal) - 1):
            if signal[i] > signal[i - 1] and signal[i] > signal[i + 1]:
                peaks.append(i)
        return peaks

    def _build_reps(
        self,
        peaks: List[int],
        signal: np.ndarray,
        action_type: str,
        troughs: Optional[List[int]] = None,
    ) -> List[Rep]:
        """从极值点构建 Rep 列表"""
        reps = []
        sorted_troughs = sorted(int(t) for t in (troughs or []))
        use_trough_boundary = action_type == 'abdominal_crunch' and bool(sorted_troughs)

        for i, peak_idx_raw in enumerate(peaks):
            peak_idx = int(peak_idx_raw)
            prev_troughs = [t for t in sorted_troughs if t < peak_idx] if use_trough_boundary else []
            next_troughs = [t for t in sorted_troughs if t > peak_idx] if use_trough_boundary else []

            if i == 0:
                # 首段优先使用“首峰前最近谷值”作为起点，避免从动作中段开始切。
                if prev_troughs:
                    start = prev_troughs[-1]
                else:
                    start = max(0, peak_idx - int(2 * self.sample_fps))
            else:
                if prev_troughs:
                    start = prev_troughs[-1]
                else:
                    start = (int(peaks[i - 1]) + peak_idx) // 2

            if i == len(peaks) - 1:
                if next_troughs:
                    end = next_troughs[0]
                else:
                    end = min(len(signal) - 1, peak_idx + int(2 * self.sample_fps))
            else:
                if next_troughs:
                    end = next_troughs[0]
                else:
                    end = (peak_idx + int(peaks[i + 1])) // 2

            # 边界异常兜底，避免出现零长度或负长度周期
            if end <= start:
                if i == len(peaks) - 1:
                    end = min(len(signal) - 1, peak_idx + int(2 * self.sample_fps))
                else:
                    end = (peak_idx + int(peaks[i + 1])) // 2
                if end <= start:
                    continue

            duration_frames = end - start
            if duration_frames < int(1.5 * self.sample_fps):
                continue

            reps.append(self._make_rep(i + 1, start, end, hold_frame=peak_idx))

        return reps

    def _make_rep(self, rep_id: int, start: int, end: int, hold_frame: Optional[int] = None) -> Rep:
        """统一创建 Rep，确保边界与 phase 索引合法。"""
        start_i = max(0, int(start))
        end_i = max(start_i + 1, int(end))
        duration_frames = end_i - start_i
        hold_i = int(hold_frame) if hold_frame is not None else start_i + int(duration_frames * 0.5)
        hold_i = max(start_i, min(hold_i, end_i))

        return Rep(
            id=rep_id,
            start_frame=start_i,
            end_frame=end_i,
            phases={
                'rest': start_i,
                'execute': start_i + int(duration_frames * 0.2),
                'hold': hold_i,
                'return': start_i + int(duration_frames * 0.8),
            },
        )

    def _refine_abdominal_fallback_reps(
        self,
        reps: List[Rep],
        signal: np.ndarray,
        troughs: Optional[List[int]] = None,
    ) -> List[Rep]:
        """回退切分后的缩腹周期修正：过滤过短 + 拆分过长。"""
        if not reps:
            return reps

        durations = [int(rep.end_frame) - int(rep.start_frame) for rep in reps]
        if not durations:
            return reps

        median_frames = int(np.median(durations))
        min_frames = max(int(2.5 * self.sample_fps), int(0.55 * median_frames))
        max_frames = max(int(14.0 * self.sample_fps), int(2.2 * median_frames))

        sorted_troughs = sorted(int(t) for t in (troughs or []))
        refined_ranges: List[tuple[int, int]] = []

        for rep in reps:
            start = int(rep.start_frame)
            end = int(rep.end_frame)
            duration = end - start

            if duration < min_frames:
                continue

            if duration > max_frames:
                split = self._pick_split_point(start, end, signal, sorted_troughs, min_frames)
                if split is not None:
                    left_duration = split - start
                    right_duration = end - split
                    if left_duration >= min_frames and right_duration >= min_frames:
                        refined_ranges.append((start, split))
                        refined_ranges.append((split, end))
                        continue

            refined_ranges.append((start, end))

        refined_ranges = sorted(refined_ranges, key=lambda x: x[0])
        normalized_reps: List[Rep] = []
        for idx, (start, end) in enumerate(refined_ranges, start=1):
            if end - start < min_frames:
                continue
            normalized_reps.append(self._make_rep(idx, start, end))

        return normalized_reps or reps

    def _pick_split_point(
        self,
        start: int,
        end: int,
        signal: np.ndarray,
        troughs: List[int],
        min_frames: int,
    ) -> Optional[int]:
        """为过长周期选择拆分点：优先内部谷值，其次局部最小值。"""
        left_bound = start + min_frames
        right_bound = end - min_frames
        if right_bound <= left_bound:
            return None

        candidates = [t for t in troughs if left_bound <= t <= right_bound]
        if candidates:
            mid = (start + end) // 2
            return min(candidates, key=lambda t: abs(t - mid))

        local = signal[left_bound:right_bound + 1]
        if len(local) <= 2:
            return None
        return left_bound + int(np.argmin(local))

    def _segment_pelvic_reps(self, signal: np.ndarray) -> List[Rep]:
        """以“稳定中立 → 后倾峰值 → 回到稳定中立”切分骨盆倾斜。

        信号是正侧方画面下的躯干—骨盆矢状面倾角。每次动作均要求峰值前后存在
        足够长的稳定中立段；准备姿势、仅做到一半及尚未回正的尾部动作均不计数。
        """
        peaks = self._find_peaks(signal, 'pelvic_tilt')
        troughs = self._find_troughs(signal, 'pelvic_tilt')

        if not peaks or not troughs:
            return []

        reps: List[Rep] = []
        # 一个完整周期需要收紧、保持与回正。标准训练稳定周期通常约 14~23 秒；
        # 低于 10 秒的往返多为调整、呼吸或关键点抖动，不单独计次。
        min_frames = int(10.0 * self.sample_fps)
        max_frames = int(30.0 * self.sample_fps)
        signal_std = float(np.std(signal)) if len(signal) else 0.0
        signal_range = float(np.max(signal) - np.min(signal)) if len(signal) else 0.0
        # 幅度阈值：峰值相对两侧中立位的倾角变化至少满足此值。
        amplitude_threshold = max(0.5, signal_std * 0.30, signal_range * 0.10)
        baseline_stability_threshold = max(0.15, signal_std * 0.12, signal_range * 0.025)
        stable_frames = max(2, int(0.7 * self.sample_fps))
        # 状态机：以连续出现的两个“稳定中立谷值”为一次动作边界。每个区间仅
        # 允许一个主峰；存在多个峰代表调整、抖动或代偿，不能被拆成多个 rep。
        stable_troughs = [
            trough for trough in troughs
            if self._is_stable_pelvic_baseline(
                signal, int(trough), stable_frames, baseline_stability_threshold,
            )
        ]
        if not stable_troughs:
            return []

        # scipy 不会将序列第 0 帧返回为谷值。若视频一开始已经处于相对稳定的
        # 中立位，首个“起始边界 → 内部稳定谷值”同样是完整闭环，不能系统性漏计。
        # 仅在首段的起始值接近首个回正谷值时补入 0；若一开始就在动作途中，则不补。
        first_trough = int(stable_troughs[0])
        # 首个动作可能在录制后立即开始，开头没有足够静止帧。此时不要求绝对平稳，
        # 只要求起始值与首个回正谷值接近，并在起始→峰值方向上形成连续单调动作。
        initial_window_end = min(len(signal), max(stable_frames + 1, int(1.0 * self.sample_fps) + 1))
        initial_window = signal[:initial_window_end]
        initial_baseline = float(np.median(initial_window))
        initial_matches_first_return = abs(initial_baseline - float(signal[first_trough])) <= amplitude_threshold
        first_peak_candidates = [peak for peak in peaks if 0 < peak < first_trough]
        initial_is_stable = False
        if first_peak_candidates:
            first_peak = int(first_peak_candidates[0])
            initial_motion = signal[:first_peak + 1]
            direction = np.sign(float(signal[first_peak]) - initial_baseline)
            if direction != 0:
                aligned_steps = np.diff(initial_motion) * direction
                initial_is_stable = float(np.mean(aligned_steps >= -baseline_stability_threshold)) >= 0.70
        else:
            initial_is_stable = float(np.ptp(initial_window)) <= baseline_stability_threshold
        boundaries = list(stable_troughs)
        if initial_is_stable and initial_matches_first_return:
            boundaries.insert(0, 0)

        # scipy 同样不会把最后一帧识别为谷值。末尾已回到与最近中立位一致、
        # 且持续稳定的信号，说明最后一个“峰值 → 回正”闭环已经完成；补入视频
        # 尾部边界以避免系统性漏掉最后一次动作。若末尾仍在回正途中，则不补入。
        last_trough = int(stable_troughs[-1])
        last_peak_candidates = [peak for peak in peaks if last_trough < peak < len(signal) - 1]
        tail_window_start = max(last_trough + 1, len(signal) - stable_frames - 1)
        tail_window = signal[tail_window_start:]
        tail_baseline = float(np.median(tail_window)) if len(tail_window) else float(signal[-1])
        tail_is_stable = len(tail_window) >= stable_frames + 1 and (
            float(np.ptp(tail_window)) <= baseline_stability_threshold
        )
        tail_matches_last_return = abs(tail_baseline - float(signal[last_trough])) <= amplitude_threshold
        if last_peak_candidates and tail_is_stable and tail_matches_last_return:
            boundaries.append(len(signal) - 1)

        if len(boundaries) < 2:
            return []

        reps: List[Rep] = []
        for start, end in zip(boundaries, boundaries[1:]):
            duration_frames = end - start
            if duration_frames < min_frames or duration_frames > max_frames:
                continue

            candidate_peaks = [peak for peak in peaks if start < peak < end]
            if not candidate_peaks:
                continue
            # 以区间内摆幅最大的峰作为“收紧下腹/后倾”的顶点。
            peak_idx = max(
                candidate_peaks,
                key=lambda peak: abs(float(signal[peak]) - (float(signal[start]) + float(signal[end])) / 2),
            )
            start_baseline = initial_baseline if start == 0 else float(signal[start])
            left_amp = abs(float(signal[peak_idx]) - start_baseline)
            right_amp = abs(float(signal[peak_idx]) - float(signal[end]))
            if min(left_amp, right_amp) < amplitude_threshold:
                continue

            reps.append(Rep(
                id=len(reps) + 1,
                start_frame=int(start),
                end_frame=int(end),
                phases={
                    'rest': int(start),
                    'execute': int(start + (peak_idx - start) * 0.35),
                    'hold': int(peak_idx),
                    'return': int(peak_idx + (end - peak_idx) * 0.35),
                },
            ))

        return reps

    @staticmethod
    def _is_stable_pelvic_baseline(
        signal: np.ndarray,
        center: int,
        stable_frames: int,
        stability_threshold: float,
    ) -> bool:
        """确认中立位在谷值附近持续稳定，而非单帧噪声低点。"""
        left = max(0, center - stable_frames)
        right = min(len(signal), center + stable_frames + 1)
        window = signal[left:right]
        return len(window) >= stable_frames + 1 and float(np.ptp(window)) <= stability_threshold

    def _detect_opening_pelvic_preparation_peak(
        self,
        signal: np.ndarray,
        peaks: List[int],
        troughs: List[int],
        amplitude_threshold: float,
    ) -> Optional[int]:
        """识别视频开头的准备姿势峰，不把它误计为训练 rep。"""
        if len(peaks) < 3 or not troughs:
            return None

        first_peak = int(peaks[0])
        # 仅检查最开始约 5 秒内的峰；正式开始较晚时不作主观排除。
        if first_peak > int(5.0 * self.sample_fps):
            return None

        def cycle_amplitude(peak: int) -> Optional[float]:
            left = [trough for trough in troughs if trough < peak]
            right = [trough for trough in troughs if trough > peak]
            if not left or not right:
                return None
            return min(
                abs(float(signal[peak]) - float(signal[left[-1]])),
                abs(float(signal[peak]) - float(signal[right[0]])),
            )

        first_amplitude = cycle_amplitude(first_peak)
        later_amplitudes = [
            amplitude for peak in peaks[1:]
            if (amplitude := cycle_amplitude(int(peak))) is not None
        ]
        if first_amplitude is None or not later_amplitudes:
            return None

        stable_amplitude = float(np.median(later_amplitudes))
        # 准备姿势需同时满足有效摆幅和明显偏离后续稳定动作，防止误伤正常首个动作。
        if (
            first_amplitude >= amplitude_threshold
            and first_amplitude > max(amplitude_threshold * 2.0, stable_amplitude * 2.2)
        ):
            logger.info(
                'Ignoring opening pelvic preparation peak: frame=%d, amplitude=%.2f, stable_median=%.2f',
                first_peak, first_amplitude, stable_amplitude,
            )
            return first_peak
        return None

    @staticmethod
    def _edge_pelvic_trough(
        signal: np.ndarray,
        peak_idx: int,
        before_peak: bool,
        window_frames: int,
    ) -> Optional[int]:
        """为首尾完整骨盆倾斜动作补齐未被 peak detector 返回的边界谷值。

        只在峰值相邻的有限窗口内取最低点，避免把很早的录制准备段整体纳入第一个周期。
        后续幅度校验会确认该最低点确实是本次动作的静息位，而不是普通噪声。
        """
        if before_peak:
            start = max(0, peak_idx - max(1, window_frames))
            segment = signal[start:peak_idx]
            if len(segment) == 0:
                return None
            return start + int(np.argmin(segment))

        end = min(len(signal), peak_idx + max(1, window_frames) + 1)
        segment = signal[peak_idx + 1:end]
        if len(segment) == 0:
            return None
        return peak_idx + 1 + int(np.argmin(segment))

    def _segment_knee_reps(self, signal: np.ndarray) -> List[Rep]:
        """膝关节旋转专用切分：以"大周期谷-峰-谷"作为完整一次动作边界。

        驱动信号为左髋-左膝连线角度。每次完整动作包含：
          屈膝准备 → 左旋（子峰1）→ 回正（内部小谷）→ 右旋（子峰2）→ 回正（大谷）

        关键设计：
        - 峰检测（min_dist=18s）：正确找到每次动作中最高的那个子峰
        - 谷检测（min_dist=25s）：使用更大的间距，确保只识别两次完整动作之间的深谷，
          跳过动作内部左旋→右旋之间的"回正小谷"，避免把一次动作切成两半
        """
        # 峰：每次完整动作的主旋转峰（左旋和右旋中较高的那个）
        peaks = self._find_peaks(signal, 'knee_rotation')

        # 谷：只找动作间的大谷，跳过动作内部左旋→右旋之间的"回正小谷"
        # min_dist=20s：每次完整动作（屈膝+左旋+右旋）约 25~35s，用 20s 确保动作内部
        # 18s 左右的回正谷被跳过，同时又不会漏掉 25~30s 周期动作之间的真实大谷。
        try:
            from scipy.signal import find_peaks as scipy_find_peaks
        except ImportError:
            troughs = self._find_troughs(signal, 'knee_rotation')
        else:
            if len(signal) >= 20:
                p5, p95 = float(np.percentile(signal, 5)), float(np.percentile(signal, 95))
                robust_range = p95 - p5
            else:
                robust_range = float(np.ptp(signal)) if len(signal) else 0.0
            trough_prominence = max(1.0, float(np.std(signal)) * 0.3, robust_range * 0.12)
            trough_min_dist = max(1, int(20.0 * self.sample_fps))  # 20s：跳过内部回正谷，保留动作间大谷
            raw_troughs, _ = scipy_find_peaks(-signal, distance=trough_min_dist, prominence=trough_prominence)
            troughs = list(raw_troughs)

        if not peaks:
            return []

        reps: List[Rep] = []
        min_frames = int(20.0 * self.sample_fps)   # 最短 20 秒（双向旋转需要足够时间）
        max_frames = int(45.0 * self.sample_fps)   # 最长 45 秒
        signal_std = float(np.std(signal)) if len(signal) else 0.0
        signal_range = float(np.max(signal) - np.min(signal)) if len(signal) else 0.0
        amplitude_threshold = max(1.0, signal_std * 0.2, signal_range * 0.05)

        rep_id = 1
        used_boundaries: set = set()
        for peak_idx in peaks:
            # 在大谷列表里找最近的前后谷作为边界
            prev_candidates = [idx for idx in troughs if idx < peak_idx]
            next_candidates = [idx for idx in troughs if idx > peak_idx]

            if prev_candidates and next_candidates:
                start = prev_candidates[-1]
                end = next_candidates[0]
            elif prev_candidates:
                # 没有后续大谷，向后延伸到合理位置（约半个动作时长）
                start = prev_candidates[-1]
                end = min(len(signal) - 1, peak_idx + int(15 * self.sample_fps))
            elif next_candidates:
                start = max(0, peak_idx - int(15 * self.sample_fps))
                end = next_candidates[0]
            else:
                start = max(0, peak_idx - int(15 * self.sample_fps))
                end = min(len(signal) - 1, peak_idx + int(15 * self.sample_fps))

            if (start, end) in used_boundaries:
                continue

            duration_frames = end - start
            if duration_frames < min_frames or duration_frames > max_frames:
                continue

            left_amp = abs(float(signal[peak_idx]) - float(signal[start]))
            right_amp = abs(float(signal[peak_idx]) - float(signal[end]))
            if max(left_amp, right_amp) < amplitude_threshold:
                continue

            used_boundaries.add((start, end))
            duration_actual = end - start
            rep = Rep(
                id=rep_id,
                start_frame=start,
                end_frame=end,
                phases={
                    'rest': start,
                    'execute': start + int(duration_actual * 0.15),   # 屈膝开始
                    'hold': peak_idx,                                   # 旋转顶峰
                    'return': start + int(duration_actual * 0.80),    # 回正开始
                },
            )
            reps.append(rep)
            rep_id += 1

        return reps

    def _segment_abdominal_reps(self, signal: np.ndarray) -> List[Rep]:
        """正侧面缩腹切分：相邻收缩峰的中点定义周期边界。

        缩腹的回位谷值常很浅且会被呼吸、衣物遮挡或姿态估计抖动淹没。强制使用
        “谷-峰-谷”会把多个真实收缩合并；因此先要求三维屈曲信号存在独立峰，再以
        相邻峰中点划分完整周期。首尾仅使用视频边界，仍接受时长与幅度双重校验。
        """
        peaks = self._find_peaks(signal, 'abdominal_crunch')
        if not peaks:
            return []

        min_frames = max(1, int(4.0 * self.sample_fps))
        max_frames = max(min_frames + 1, int(18.0 * self.sample_fps))
        if len(signal) >= 20:
            robust_range = float(np.percentile(signal, 95) - np.percentile(signal, 5))
        else:
            robust_range = float(np.ptp(signal)) if len(signal) else 0.0
        # 峰已通过 prominence 校验；这里仅再做局部摆幅下限校验。
        # 不使用全局 max-min：首尾姿态估计突变会将它放大，使正常收缩峰被全部过滤。
        amplitude_threshold = max(0.20, robust_range * 0.12)

        reps: List[Rep] = []
        for index, peak_idx in enumerate(peaks):
            start = 0 if index == 0 else (int(peaks[index - 1]) + int(peak_idx)) // 2
            end = len(signal) - 1 if index == len(peaks) - 1 else (int(peak_idx) + int(peaks[index + 1])) // 2
            duration_frames = end - start
            if duration_frames < min_frames or duration_frames > max_frames:
                continue

            cycle_signal = signal[start:end + 1]
            # 中位数会落在一次完整收缩的中间位置，系统性低估小幅但真实的收缩。
            # 用较低分位数作为静息基线，同时以 find_peaks 的显著性规则抑制抖动误检。
            baseline = float(np.percentile(cycle_signal, 20))
            amplitude = abs(float(signal[peak_idx]) - baseline)
            if amplitude < amplitude_threshold:
                continue

            reps.append(self._make_rep(len(reps) + 1, start, end, hold_frame=int(peak_idx)))

        return reps
