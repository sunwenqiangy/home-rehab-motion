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

            # abdominal_displacement: 肩-髋中点在矢状面方向的相对后移量
            displacements = []
            for f in rep_frames:
                if f.shoulder_mid and f.hip_mid:
                    # Y轴方向位移（归一化后）
                    dy = f.shoulder_mid[1] - f.hip_mid[1]
                    displacements.append(abs(dy))
            if displacements:
                params['abdominal_displacement'] = float(np.mean(displacements)) * 100  # 转为 mm proxy

            # displacement_velocity
            if len(displacements) > 1:
                velocities = np.abs(np.diff(displacements)) * sample_fps
                params['displacement_velocity'] = float(np.mean(velocities)) * 100

            # trunk_angle_change: 躯干向量与初始帧夹角
            trunk_changes = self._compute_trunk_changes(rep_frames)
            if trunk_changes:
                params['trunk_angle_change'] = float(np.max(np.abs(trunk_changes)))

            # hold_duration
            params['hold_duration'] = self._compute_hold_duration(rep_frames, sample_fps)

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
    def _compute_hold_duration(frames: List[Frame], sample_fps: int) -> float:
        """计算保持时间：位移超过阈值后连续帧数 × 帧间隔"""
        if len(frames) < 2:
            return 0.0
        # 简化：rep 时长 * 0.4 作为保持时间估计
        return len(frames) / sample_fps * 0.4

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

            # pelvic_tilt_delta: 骨盆倾斜幅度 = 周期内角度极差（max - min）
            # 与可视化文档一致：完整摆幅而非相对初始帧的偏离
            tilt_angles = self._compute_pelvic_tilt_deltas(rep_frames)
            if tilt_angles:
                params['pelvic_tilt_delta'] = float(np.max(tilt_angles) - np.min(tilt_angles))

            # pelvis_shift: 骨盆横向（X轴）偏移 %
            # 与可视化文档一致：仅取 X 轴，以前 3 帧均值为静息参考
            shift_x = self._compute_pelvis_shift(rep_frames)
            if shift_x:
                params['pelvis_shift'] = float(np.max(np.abs(shift_x))) * 100

            # trunk_angle_change: 躯干角度极差（max - min）
            # 与可视化文档一致：反映整个周期的躯干晃动幅度
            trunk_angles = self._compute_trunk_angles(rep_frames)
            if trunk_angles:
                params['trunk_angle_change'] = float(np.max(trunk_angles) - np.min(trunk_angles))

            # hold_duration: 速度方差法（顶峰保持时长）
            params['hold_duration'] = self._compute_hold_duration_velocity(rep_frames, sample_fps)

            results[f'rep_{rep.id}'] = params

        results['video_avg'] = AbdominalCrunchCalculator._average_params(results)
        return results

    @staticmethod
    def _compute_pelvic_tilt_deltas(frames: List[Frame]) -> List[float]:
        """骨盆倾斜角度序列（用于计算极差 = 骨盆活动度）
        公式：arctan2(rh.y - lh.y, rh.x - lh.x)，单位：度。
        返回各帧的绝对角度序列，由 calculate() 计算 max-min 极差。
        """
        if not frames:
            return []

        angles = []
        for f in frames:
            lh = f.keypoints.get('LEFT_HIP')
            rh = f.keypoints.get('RIGHT_HIP')
            if lh and rh:
                angle = np.degrees(np.arctan2(rh.y - lh.y, rh.x - lh.x))
                angles.append(angle)
        return angles

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
    def _compute_hold_duration_velocity(frames: List[Frame], sample_fps: int) -> float:
        """速度方差法计算顶峰保持时长（与可视化文档一致）：
        1. 计算骨盆角度的逐帧速度（帧间差）
        2. 速度低于 std(vel) × 0.5 视为保持状态
        3. 统计满足条件的帧数 / fps = 保持时长（秒）
        """
        if len(frames) < 3:
            return 0.0

        # 提取骨盆角度序列
        angles = []
        for f in frames:
            lh = f.keypoints.get('LEFT_HIP')
            rh = f.keypoints.get('RIGHT_HIP')
            if lh and rh:
                angle = np.degrees(np.arctan2(rh.y - lh.y, rh.x - lh.x))
                angles.append(angle)

        if len(angles) < 3:
            return 0.0

        vel = np.abs(np.diff(angles))
        thr = float(np.std(vel)) * 0.5
        hold_frames = int(np.sum(vel <= thr))
        return hold_frames / sample_fps


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
