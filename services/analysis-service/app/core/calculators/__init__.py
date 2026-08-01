"""Step 5: 参数计算器 — 按动作类型分发"""

import logging
from typing import Dict, List, Optional

import numpy as np

from app.core.models import Frame, Rep

logger = logging.getLogger(__name__)


class BaseCalculator:
    """参数计算器基类"""

    def calculate(self, frames: List[Frame], reps: List[Rep],
                  sample_fps: int = 10) -> Dict[str, Dict]:
        """
        计算参数

        Returns:
            {
                'rep_1': {'param_name': value, ...},
                'rep_2': {...},
                'video_avg': {'param_name': value, ...},
            }
        """
        raise NotImplementedError


class AbdominalCrunchCalculator(BaseCalculator):
    """缩腹运动参数计算"""

    def calculate(self, frames: List[Frame], reps: List[Rep],
                  sample_fps: int = 10) -> Dict[str, Dict]:
        results = {}

        for rep in reps:
            rep_frames = frames[rep.start_frame:rep.end_frame + 1]
            params = {}

            # 正侧面缩腹以三维肩髋向量的屈曲幅度为主，既覆盖前屈也覆盖深度方向收缩。
            flexion_signal = self._compute_flexion_signal(rep_frames)
            if len(flexion_signal) >= 3:
                baseline = float(np.percentile(flexion_signal, 10))
                peak = float(np.percentile(flexion_signal, 90))
                amplitude = max(0.0, peak - baseline)
                params['abdominal_displacement'] = amplitude  # 单位：deg

                peak_index = int(np.argmax(flexion_signal))
                execute = np.asarray(flexion_signal[:peak_index + 1], dtype=float)
                velocities = np.abs(np.diff(execute)) * sample_fps
                velocities = velocities[np.isfinite(velocities)]
                if len(velocities):
                    # 用中位数抑制单帧关键点跳变，单位 deg/s。
                    params['displacement_velocity'] = float(np.median(velocities))
                params['hold_duration'] = self._compute_peak_hold_duration(
                    flexion_signal,
                    peak_index,
                    baseline,
                    peak,
                    sample_fps,
                )
            else:
                params['hold_duration'] = 0.0

            # trunk_angle_change: 躯干向量与初始帧夹角
            trunk_changes = self._compute_trunk_changes(rep_frames)
            if trunk_changes:
                params['trunk_angle_change'] = float(np.max(np.abs(trunk_changes)))

            results[f'rep_{rep.id}'] = params

        # 视频级平均
        results['video_avg'] = self._average_params(results)

        return results

    @staticmethod
    def _compute_trunk_changes(frames: List[Frame]) -> List[float]:
        changes = []
        if not frames or frames[0].shoulder_mid is None or frames[0].hip_mid is None:
            return changes

        init_shoulder = frames[0].shoulder_mid
        init_hip = frames[0].hip_mid
        init_vec = np.array([init_shoulder[0] - init_hip[0],
                             init_shoulder[1] - init_hip[1]])

        for f in frames:
            if f.shoulder_mid and f.hip_mid:
                curr_vec = np.array([f.shoulder_mid[0] - f.hip_mid[0],
                                     f.shoulder_mid[1] - f.hip_mid[1]])
                cos_angle = np.clip(np.dot(init_vec, curr_vec) /
                                    (np.linalg.norm(init_vec) * np.linalg.norm(curr_vec) + 1e-8),
                                    -1, 1)
                angle = np.degrees(np.arccos(cos_angle))
                changes.append(angle)
        return changes

    @staticmethod
    def _compute_flexion_signal(frames: List[Frame]) -> List[float]:
        values = []
        for frame in frames:
            if frame.shoulder_mid is None or frame.hip_mid is None:
                continue
            dx = frame.shoulder_mid[0] - frame.hip_mid[0]
            dy = frame.shoulder_mid[1] - frame.hip_mid[1]
            dz = frame.shoulder_mid[2] - frame.hip_mid[2]
            value = np.degrees(np.arctan2(np.hypot(dx, dz), abs(dy) + 1e-8))
            if np.isfinite(value):
                values.append(float(value))
        return values

    @staticmethod
    def _compute_peak_hold_duration(
        signal: List[float],
        peak_index: int,
        baseline: float,
        peak: float,
        sample_fps: int,
    ) -> float:
        """围绕真实收缩峰计算连续平台时长，而非用周期时长比例估算。"""
        amplitude = peak - baseline
        if amplitude <= 1e-6 or sample_fps <= 0:
            return 0.0
        threshold = baseline + amplitude * 0.85
        left = peak_index
        right = peak_index
        while left > 0 and signal[left - 1] >= threshold:
            left -= 1
        while right + 1 < len(signal) and signal[right + 1] >= threshold:
            right += 1
        return (right - left + 1) / sample_fps

    @staticmethod
    def _average_params(results: Dict) -> Dict:
        if not results:
            return {}
        avg = {}
        param_sums = {}
        param_counts = {}
        for key, params in results.items():
            if key == 'video_avg':
                continue
            for pname, pval in params.items():
                if not isinstance(pval, (int, float)) or not np.isfinite(pval):
                    continue
                param_sums[pname] = param_sums.get(pname, 0.0) + pval
                param_counts[pname] = param_counts.get(pname, 0) + 1

        for pname in param_sums:
            avg[pname] = param_sums[pname] / param_counts[pname]
        return avg


class PelvicTiltCalculator(BaseCalculator):
    """骨盆倾斜参数计算"""

    def calculate(self, frames: List[Frame], reps: List[Rep],
                  sample_fps: int = 10) -> Dict[str, Dict]:
        results = {}

        for rep in reps:
            rep_frames = frames[rep.start_frame:rep.end_frame + 1]
            params = {}

            # 评分幅度必须与已发布金标准模板使用同一口径：左右髋在画面平面中的
            # 连线角度全周期极差。此前切换为三维稳健极差后，特征量纲与现有模板
            # 不一致，导致真实骨盆动作被系统性低估。
            tilt_angles = self._compute_pelvic_tilt_deltas(rep_frames)
            if tilt_angles:
                params['pelvic_tilt_delta'] = float(np.max(tilt_angles) - np.min(tilt_angles))

            # pelvis_shift: 骨盆横向（X轴）偏移 %
            # 与可视化文档一致：仅取 X 轴，以前 3 帧均值为静息参考
            shift_x = self._compute_pelvis_shift(rep_frames)
            if shift_x:
                params['pelvis_shift'] = float(np.max(np.abs(shift_x))) * 100

            # 与周期信号一致：主要后倾不再作为"躯干代偿"。该指标仅保留
            # 顶点附近的额外晃动，避免首周期的完整动作幅度被判成躯干不稳定。
            sagittal_angles = self._compute_pelvic_sagittal_angles(rep_frames)
            if sagittal_angles:
                params['trunk_angle_change'] = self._compute_peak_residual_motion(sagittal_angles)

            # 顶点保持时长使用同一矢状面信号，避免左右髋线噪声造成首周期虚长。
            params['hold_duration'] = self._compute_hold_duration_velocity(sagittal_angles, sample_fps)

            results[f'rep_{rep.id}'] = params

        results['video_avg'] = AbdominalCrunchCalculator._average_params(results)
        return results

    @staticmethod
    def _compute_pelvic_tilt_deltas(frames: List[Frame]) -> List[float]:
        """返回画面平面内左右髋连线的绝对角度序列，单位为度。"""
        angles = []
        for frame in frames:
            left_hip = frame.keypoints.get('LEFT_HIP')
            right_hip = frame.keypoints.get('RIGHT_HIP')
            if left_hip is None or right_hip is None:
                continue
            value = float(np.degrees(np.arctan2(
                right_hip.y - left_hip.y,
                right_hip.x - left_hip.x,
            )))
            if np.isfinite(value):
                angles.append(value)
        return angles

    @staticmethod
    def _compute_pelvic_sagittal_angles(frames: List[Frame]) -> List[float]:
        """正侧方画面下躯干—骨盆的有符号矢状面倾角，单位为度。"""
        angles = []
        for frame in frames:
            if frame.shoulder_mid is None or frame.hip_mid is None:
                continue
            dx = frame.shoulder_mid[0] - frame.hip_mid[0]
            dy = frame.hip_mid[1] - frame.shoulder_mid[1]
            value = float(np.degrees(np.arctan2(dx, dy)))
            if np.isfinite(value):
                angles.append(value)
        return angles

    @staticmethod
    def _compute_pelvic_rotation_angles(frames: List[Frame]) -> List[float]:
        """以左右髋的三维相对高度表示骨盆本体在矢状面内的旋转。

        该信号与躯干倾角互补：骨盆倾斜时应能观察到髋部姿态变化；缩腹主要是
        肩部向前/向深度方向移动，髋部旋转不足，不能仅靠躯干变化取得高分。
        """
        angles = []
        for frame in frames:
            left_hip = frame.keypoints.get('LEFT_HIP')
            right_hip = frame.keypoints.get('RIGHT_HIP')
            if left_hip is None or right_hip is None:
                continue
            dx = right_hip.x - left_hip.x
            dy = right_hip.y - left_hip.y
            dz = right_hip.z - left_hip.z
            value = float(np.degrees(np.arctan2(dy, np.hypot(dx, dz) + 1e-8)))
            if np.isfinite(value):
                angles.append(value)
        return angles

    @staticmethod
    def _compute_effective_sagittal_amplitude(angles: List[float]) -> float:
        """计算后倾有效摆幅，抑制首尾入镜与关键点跳变对极差的放大。"""
        values = np.asarray(angles, dtype=float)
        if len(values) < 3:
            return 0.0
        # 使用 10%~90% 分位数作为完整动作的稳健摆幅，避免单帧姿态估计跳变。
        return max(0.0, float(np.percentile(values, 90) - np.percentile(values, 10)))

    @staticmethod
    def _compute_peak_residual_motion(angles: List[float]) -> float:
        """顶点附近的额外摆动，用于识别后倾完成后是否仍有明显晃动。"""
        values = np.asarray(angles, dtype=float)
        if len(values) < 4:
            return 0.0
        peak_idx = int(np.argmax(np.abs(values - np.median(values))))
        radius = max(1, len(values) // 8)
        window = values[max(0, peak_idx - radius):min(len(values), peak_idx + radius + 1)]
        if len(window) < 2:
            return 0.0
        return max(0.0, float(np.percentile(window, 90) - np.percentile(window, 10)))

    @staticmethod
    def _compute_pelvis_shift(frames: List[Frame]) -> List[float]:
        """骨盆横向（X 轴）偏移序列。
        以前 3 帧均值作为静息参考，与可视化文档一致：
          pelvis_shift = max(|hip_mid_x - rest_x|) × 100
        单位：归一化坐标差（调用处乘以 100 转为 %）。
        """
        if not frames:
            return []

        # 计算前 3 帧（或全部帧）的髋中点 X 均值作为静息参考
        rest_xs = []
        for f in frames[:3]:
            if f.hip_mid is not None:
                rest_xs.append(f.hip_mid[0])
        if not rest_xs:
            return []
        rest_x = float(np.mean(rest_xs))

        shifts = []
        for f in frames:
            if f.hip_mid is not None:
                shifts.append(f.hip_mid[0] - rest_x)
        return shifts

    @staticmethod
    def _compute_trunk_angles(frames: List[Frame]) -> List[float]:
        """每帧的躯干绝对角度序列（arctan2 肩-髋向量与垂直轴夹角，单位：度）。
        pelvic_tilt_calculator 用 max - min 极差计算 trunk_angle_change，
        与可视化文档一致，不再依赖第 0 帧基准。
        """
        angles = []
        for f in frames:
            if f.shoulder_mid is not None and f.hip_mid is not None:
                sx, sy = f.shoulder_mid[0], f.shoulder_mid[1]
                hx, hy = f.hip_mid[0], f.hip_mid[1]
                angle = np.degrees(np.arctan2(sx - hx, -(hy - sy + 1e-8)))
                angles.append(angle)
        return angles

    @staticmethod
    def _compute_hold_duration_velocity(angles: List[float], sample_fps: int) -> float:
        """围绕矢状面后倾顶点计算连续保持时长，而不是累计所有低速帧。"""
        values = np.asarray(angles, dtype=float)
        if len(values) < 3 or sample_fps <= 0:
            return 0.0

        baseline = float(np.median(values))
        peak_idx = int(np.argmax(np.abs(values - baseline)))
        peak_deviation = abs(float(values[peak_idx]) - baseline)
        if peak_deviation <= 1e-6:
            return 0.0

        # 顶点附近仍保持至少 85% 后倾幅度的连续区间，才是本次动作的保持。
        threshold = peak_deviation * 0.85
        left = peak_idx
        right = peak_idx
        while left > 0 and abs(float(values[left - 1]) - baseline) >= threshold:
            left -= 1
        while right + 1 < len(values) and abs(float(values[right + 1]) - baseline) >= threshold:
            right += 1
        return (right - left + 1) / sample_fps


class KneeRotationCalculator(BaseCalculator):
    """膝关节旋转参数计算"""

    def calculate(self, frames: List[Frame], reps: List[Rep],
                  sample_fps: int = 10) -> Dict[str, Dict]:
        results = {}

        for rep in reps:
            rep_frames = frames[rep.start_frame:rep.end_frame + 1]
            params = {}

            # knee_rotation_angle: 每次动作周期内双膝X轴横移极差（左右旋转幅度）
            # 膝关节旋转：双膝向左/右倒，主要体现在 X 轴横移
            knee_x_range = self._compute_knee_x_range(rep_frames)
            if knee_x_range is not None:
                params['knee_rotation_angle'] = float(knee_x_range) * 100  # 归一化到 %

            # knee_symmetry: 左右旋转幅度对称性（1.0=完全对称）
            symmetry = self._compute_knee_symmetry(rep_frames)
            if symmetry is not None:
                params['knee_symmetry'] = symmetry

            # rotation_velocity: 旋转速度（双膝横向速度均值）
            rotations = self._compute_knee_rotations(rep_frames)
            if len(rotations) > 1:
                velocities = np.abs(np.diff(rotations)) * sample_fps
                velocities = velocities[np.isfinite(velocities)]
                if len(velocities):
                    params['rotation_velocity'] = float(np.mean(velocities)) * 100

            # trunk_angle_change: 躯干代偿角（旋转时上身不应随之转动）
            trunk_changes = AbdominalCrunchCalculator._compute_trunk_changes(rep_frames)
            if trunk_changes:
                params['trunk_angle_change'] = float(np.max(np.abs(trunk_changes)))

            results[f'rep_{rep.id}'] = params

        results['video_avg'] = AbdominalCrunchCalculator._average_params(results)
        return results

    @staticmethod
    def _compute_knee_x_range(frames: List[Frame]) -> Optional[float]:
        """单向最大旋转幅度：以 rep 前3帧（休息位）为基准，
        计算双膝中点 X 轴相对于基准的最大绝对偏移量。

        膝关节旋转动作 = 左旋 + 右旋，若用 max-min 极差会将双向幅度叠加，
        导致长周期 rep（含双向旋转）的值是短周期的2~3倍，产生系统性误差。
        改为取相对休息位的最大单向偏移，与实际旋转幅度概念一致。
        """
        xs = []
        for f in frames:
            lk = f.keypoints.get('LEFT_KNEE')
            rk = f.keypoints.get('RIGHT_KNEE')
            if lk and rk:
                xs.append((lk.x + rk.x) / 2)
        if len(xs) < 2:
            return None

        # 用前3帧均值作为休息位基准
        rest_x = float(np.mean(xs[:min(3, len(xs))]))
        # 单向最大偏移（取正负方向中较大的一侧）
        deviations = [abs(x - rest_x) for x in xs]
        return float(max(deviations))

    @staticmethod
    def _compute_knee_rotations(frames: List[Frame]) -> List[float]:
        """双膝中点 Y 轴偏移序列（用于速度计算）。
        以前 3 帧均值为静息参考。
        """
        if not frames:
            return []

        # 前 3 帧均值作为静息 Y 参考
        rest_ys = []
        for f in frames[:3]:
            lk = f.keypoints.get('LEFT_KNEE')
            rk = f.keypoints.get('RIGHT_KNEE')
            if lk and rk:
                rest_ys.append((lk.y + rk.y) / 2)
        if not rest_ys:
            return []
        rest_y = float(np.mean(rest_ys))

        rotations = []
        for f in frames:
            lk = f.keypoints.get('LEFT_KNEE')
            rk = f.keypoints.get('RIGHT_KNEE')
            if lk and rk:
                mid_y = (lk.y + rk.y) / 2
                rotations.append(mid_y - rest_y)
        return rotations

    @staticmethod
    def _compute_knee_symmetry(frames: List[Frame]) -> float:
        """左右倾倒幅度比值"""
        if not frames:
            return 0.0

        lk_positions = []
        rk_positions = []
        for f in frames:
            lk = f.keypoints.get('LEFT_KNEE')
            rk = f.keypoints.get('RIGHT_KNEE')
            if lk and rk:
                lk_positions.append(lk.x)
                rk_positions.append(rk.x)

        if len(lk_positions) < 2:
            return 0.0

        lk_range = max(lk_positions) - min(lk_positions)
        rk_range = max(rk_positions) - min(rk_positions)

        if max(lk_range, rk_range) < 1e-6:
            return 1.0

        return min(lk_range, rk_range) / max(lk_range, rk_range)


# 计算器工厂
CALCULATORS = {
    'abdominal_crunch': AbdominalCrunchCalculator,
    'pelvic_tilt': PelvicTiltCalculator,
    'knee_rotation': KneeRotationCalculator,
}


def get_calculator(action_type: str) -> BaseCalculator:
    """获取对应动作类型的计算器"""
    cls = CALCULATORS.get(action_type)
    if cls is None:
        raise ValueError(f'Unknown action type: {action_type}')
    return cls()
