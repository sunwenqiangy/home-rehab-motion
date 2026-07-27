#!/usr/bin/env python3
"""
金标准快速提取脚本（三段式运动版）
从教学视频中按时间段分别提取三种运动的金标准模板

使用方法：
    python3.11 extract_gold_standard.py

输出：
    gold_standard_output/
    ├── raw_keypoints.json                  完整视频逐帧关键点
    ├── abdominal_crunch/
    │   ├── cycle_params.json               各周期参数
    │   ├── template.json                   ⭐ 金标准模板（入库用）
    │   └── report.txt                      分析报告
    ├── pelvic_tilt/
    │   ├── cycle_params.json
    │   ├── template.json
    │   └── report.txt
    └── knee_rotation/
        ├── cycle_params.json
        ├── template.json
        └── report.txt
"""

import os
import sys
import json
import time
import traceback
from pathlib import Path


# ─── 依赖检测 ─────────────────────────────────────────────────────────────────

def check_dependencies():
    missing = []
    for pkg, import_name in [
        ("mediapipe", "mediapipe"),
        ("opencv-python", "cv2"),
        ("numpy", "numpy"),
        ("scipy", "scipy"),
    ]:
        try:
            __import__(import_name)
        except ImportError:
            missing.append(pkg)

    if missing:
        print("❌ 缺少依赖，请先运行：")
        print(f"   python3.11 -m pip install {' '.join(missing)}")
        sys.exit(1)
    print("✅ 依赖检测通过")


# ─── 配置 ─────────────────────────────────────────────────────────────────────

OUTPUT_DIR       = Path(__file__).parent / "gold_standard_output"
APPEND_OUTPUT_DIR = OUTPUT_DIR / "append_standard_videos"
SAMPLE_FPS       = 10     # 降采样帧率（CPU 优化）
SIGMA_MULTIPLIER = 2.0    # 初始阈值宽度（2σ，适应单视频不确定性）

# 基线模板目录（历史定义）
BASELINE_TEMPLATE_DIR = OUTPUT_DIR

# 新增标准视频目录（每个视频只包含一个动作）
NEW_STANDARD_VIDEO_SOURCES = [
    {
        "action_type": "abdominal_crunch",
        "action_label": "缩腹运动",
        "video_path": Path(__file__).parent / "prd" / "标准教学视频" / "缩腹运动.mp4",
    },
    {
        "action_type": "pelvic_tilt",
        "action_label": "骨盆倾斜",
        "video_path": Path(__file__).parent / "prd" / "标准教学视频" / "骨盆倾斜运动.mp4",
    },
    {
        "action_type": "knee_rotation",
        "action_label": "膝关节旋转",
        "video_path": Path(__file__).parent / "prd" / "标准教学视频" / "膝关节旋转.mp4",
    },
]

APPEND_COMPARE_JSON = OUTPUT_DIR / "append_vs_existing_comparison.json"
APPEND_COMPARE_TXT  = OUTPUT_DIR / "append_vs_existing_comparison.txt"

# MediaPipe 关键点索引（33点模型）
KP = {
    "nose":           0,
    "left_shoulder":  11, "right_shoulder": 12,
    "left_elbow":     13, "right_elbow":    14,
    "left_wrist":     15, "right_wrist":    16,
    "left_hip":       23, "right_hip":      24,
    "left_knee":      25, "right_knee":     26,
    "left_ankle":     27, "right_ankle":    28,
}

# ── 各动作类型核心参数 + 元数据 ──────────────────────────────────────────────
PARAM_META = {
    # 通用参数
    "hold_duration": {
        "direction": "larger_better",
        "unit": "秒",
        "description": "动作保持时长（越长越好）",
    },
    "trunk_angle_change": {
        "direction": "smaller_better",
        "unit": "度",
        "description": "躯干角度代偿变化量（越小越稳定）",
    },
    "pelvis_shift": {
        "direction": "smaller_better",
        "unit": "相对画面宽度 %",
        "description": "骨盆水平偏移（越小越稳定）",
    },
    # 缩腹专属
    "abdominal_displacement": {
        "direction": "larger_better",
        "unit": "相对画面高度 %",
        "description": "腹部收缩位移（肩-髋中点代理，越大收缩越充分）",
    },
    "displacement_velocity": {
        "direction": "moderate",
        "unit": "% /秒",
        "description": "收缩速度（不宜过快或过慢）",
    },
    # 骨盆倾斜专属
    "pelvic_tilt_delta": {
        "direction": "larger_better",
        "unit": "度",
        "description": "骨盆倾斜变化量（双髋连线角度变化，代理骨盆前后倾活动度）",
    },
    "pelvic_tilt_velocity": {
        "direction": "moderate",
        "unit": "度/秒",
        "description": "骨盆倾斜速度（不宜过快或过慢）",
    },
    # 膝关节旋转专属（正侧面拍摄版）
    # 侧面拍摄时：膝盖左右倒动 → Y轴偏移可见，X轴偏移≈0（头脚方向不动）
    "knee_y_excursion": {
        "direction": "larger_better",
        "unit": "%",
        "description": "膝盖Y轴偏移幅度（侧面可见，越大说明倒膝幅度充分）",
    },
    "hip_stability": {
        "direction": "smaller_better",
        "unit": "%",
        "description": "倒膝时髋中点Y轴抖动量（越小说明骨盆越稳定，代偿越少）",
    },
}

# 各动作类型需要计算的参数列表
ACTION_PARAMS = {
    "abdominal_crunch": [
        "abdominal_displacement",
        "displacement_velocity",
        "hold_duration",
        "trunk_angle_change",
        "pelvis_shift",
    ],
    "pelvic_tilt": [
        "pelvic_tilt_delta",
        "pelvic_tilt_velocity",
        "hold_duration",
        "trunk_angle_change",
        "pelvis_shift",
    ],
    "knee_rotation": [
        "knee_y_excursion",   # 膝盖Y轴偏移幅度（侧面主指标）
        "hip_stability",      # 髋部稳定性（倒膝时骨盆代偿）
        "trunk_angle_change", # 躯干代偿（通用，侧面可测）
    ],
}


# ─── Step 1: 提取关键点（支持时间范围裁剪）────────────────────────────────────

def extract_keypoints(video_path: Path,
                      start_sec: float = 0.0,
                      end_sec: float = None) -> list:
    """
    使用 MediaPipe Pose 从视频中提取关键点（CPU 模式，10fps 降采样）
    支持按时间段裁剪，仅处理 [start_sec, end_sec] 内的帧

    返回：[{frame_idx, timestamp_ms, keypoints: {name: {x,y,z,visibility}},
            avg_confidence, missing_keypoints}]
    """
    import cv2
    import mediapipe as mp

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频文件: {video_path}")

    orig_fps     = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    total_dur    = total_frames / orig_fps if orig_fps > 0 else 0

    if end_sec is None:
        end_sec = total_dur

    # 计算起止帧号
    start_frame = int(start_sec * orig_fps)
    end_frame   = min(int(end_sec * orig_fps), total_frames - 1)
    seg_dur     = end_sec - start_sec

    frame_interval = max(1, int(orig_fps / SAMPLE_FPS))
    expected_samples = int(seg_dur * SAMPLE_FPS)

    print(f"   视频总时长: {total_dur:.1f}s  |  帧率: {orig_fps:.1f}fps")
    print(f"   截取片段:   {start_sec:.0f}s ~ {end_sec:.0f}s  ({seg_dur:.0f}s)")
    print(f"   帧范围:     {start_frame} ~ {end_frame}  (预计采样 ~{expected_samples} 帧)")

    # 跳到起始帧
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        smooth_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    frames_data  = []
    frame_idx    = start_frame
    sample_count = 0
    t_start      = time.time()

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret or frame_idx > end_frame:
            break

        if (frame_idx - start_frame) % frame_interval == 0:
            timestamp_ms = frame_idx / orig_fps * 1000.0  # 视频绝对时间戳

            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results   = pose.process(rgb_frame)

            if results.pose_landmarks:
                kps         = {}
                confidences = []

                for name, idx in KP.items():
                    lm = results.pose_landmarks.landmark[idx]
                    kps[name] = {
                        "x":          float(lm.x),
                        "y":          float(lm.y),
                        "z":          float(lm.z),
                        "visibility": float(lm.visibility),
                    }
                    confidences.append(float(lm.visibility))

                avg_conf      = sum(confidences) / len(confidences)
                missing_count = sum(1 for c in confidences if c < 0.5)

                frames_data.append({
                    "frame_idx":        frame_idx,
                    "timestamp_ms":     float(timestamp_ms),
                    "keypoints":        kps,
                    "avg_confidence":   avg_conf,
                    "missing_keypoints": missing_count,
                })
                sample_count += 1

                if sample_count % 20 == 0:
                    elapsed  = time.time() - t_start
                    progress = (frame_idx - start_frame) / max(1, end_frame - start_frame) * 100
                    print(f"   {progress:.0f}% | 已采样 {sample_count} 帧 | 耗时 {elapsed:.1f}s")

        frame_idx += 1

    cap.release()
    pose.close()

    elapsed = time.time() - t_start
    print(f"   ✅ 提取完成: {len(frames_data)} 帧 | 耗时 {elapsed:.1f}s")

    return frames_data


# ─── Step 2: 质量校验 ─────────────────────────────────────────────────────────

def quality_check(frames_data: list) -> dict:
    """对关键点数据进行质量检验"""
    total = len(frames_data)
    if total == 0:
        return {"pass": False, "reason": "无有效帧", "total_frames": 0,
                "avg_confidence": 0, "missing_rate": 1, "warnings": []}

    avg_conf     = sum(f["avg_confidence"]   for f in frames_data) / total
    avg_missing  = sum(f["missing_keypoints"] for f in frames_data) / total
    missing_rate = avg_missing / len(KP)

    report = {
        "total_frames":  total,
        "avg_confidence": round(avg_conf, 4),
        "missing_rate":   round(missing_rate, 4),
        "pass":   avg_conf >= 0.7 and missing_rate < 0.20,
        "warnings": [],
    }

    if avg_conf < 0.85:
        report["warnings"].append(f"⚠️ 平均置信度 {avg_conf:.2f} 低于 0.85，建议检查视频光线/角度")
    if avg_conf < 0.7:
        report["pass"]   = False
        report["reason"] = f"置信度过低 ({avg_conf:.2f} < 0.7)"
    if missing_rate > 0.20:
        report["warnings"].append(f"⚠️ 关键点缺失率 {missing_rate:.1%} 较高（部分肢体遮挡）")

    status_icon = "✅" if report["pass"] else "❌"
    print(f"   平均置信度: {avg_conf:.3f}  {'✅' if avg_conf >= 0.7 else '❌'}")
    print(f"   缺失率:     {missing_rate:.1%}  {'✅' if missing_rate < 0.20 else '❌'}")
    print(f"   质量结论:   {status_icon} {'通过' if report['pass'] else '不通过'}")
    for w in report["warnings"]:
        print(f"   {w}")

    return report


# ─── Step 3: 周期切分（按动作类型用不同信号）────────────────────────────────

def segment_phases(frames_data: list, action_type: str) -> list:
    """
    按动作类型选择合适的驱动信号检测训练周期：
    - abdominal_crunch : 躯干角度绝对值（呼吸/收缩时骨盆-肩连线角轻微变化）
                        ⚠️ 注意：正确缩腹时躯干应保持不动；这里用躯干角度的
                        周期性微小波动（呼吸驱动）来检测训练节奏，而非大幅位移。
                        切分信号与 abdominal_displacement 计算信号完全分离，
                        避免选择偏差（selection bias）。
    - pelvic_tilt      : 双髋连线与水平线夹角（骨盆倾斜角）
    - knee_rotation    : 左膝髋-膝-踝夹角
    """
    import numpy as np
    from scipy.signal import find_peaks

    if len(frames_data) < 8:
        print("   ⚠️ 帧数不足，无法切分")
        return []

    timestamps = [f["timestamp_ms"] / 1000.0 for f in frames_data]

    # ── 选择驱动信号 ──
    signal = []
    if action_type == "abdominal_crunch":
        # 【改】切分信号：使用躯干角度（肩中点-髋中点连线与垂直轴夹角）的周期变化
        # 理由：正确缩腹时躯干保持不动（trunk_angle ≈ 0），用角度绝对值检测呼吸/动作节奏
        # 切分信号与 calculate_params 中的 abdominal_displacement 完全不同，
        # 消除了「用同一个信号切周期再统计该信号均值」的选择偏差
        for f in frames_data:
            k = f["keypoints"]
            sx = (k["left_shoulder"]["x"] + k["right_shoulder"]["x"]) / 2
            sy = (k["left_shoulder"]["y"] + k["right_shoulder"]["y"]) / 2
            hx = (k["left_hip"]["x"]      + k["right_hip"]["x"])      / 2
            hy = (k["left_hip"]["y"]      + k["right_hip"]["y"])      / 2
            dy = sy - hy
            angle = float(np.degrees(np.arctan2(sx - hx, -dy + 1e-8)))
            signal.append(angle)
        # 找极大值（躯干偏移角在收缩时短暂增大后回正，形成波峰）
        invert = False

    elif action_type == "pelvic_tilt":
        # 双髋连线角（骨盆倾斜时角度变化）
        for f in frames_data:
            k = f["keypoints"]
            dx = k["right_hip"]["x"] - k["left_hip"]["x"]
            dy = k["right_hip"]["y"] - k["left_hip"]["y"]
            angle = float(np.degrees(np.arctan2(dy, dx + 1e-8)))
            signal.append(angle)
        # 找极大/极小均可，这里找极大值（倾斜峰值）
        invert = False

    elif action_type == "knee_rotation":
        # 【正侧面版】膝关节旋转 = 仰卧位双膝左右倾倒动作
        # 正侧面拍摄时：膝盖向腹侧/背侧倾倒 → Y轴位移可见
        # 驱动信号：双膝中点 Y 轴位置
        #   正确姿势：膝弯曲约90°竖立 → 倒向腹侧时 Y 减小（膝向上/前倾）
        #             → 倒向背侧时 Y 增大 → 交替形成波峰
        # 找极大值（膝倒向背侧到最低点时 Y 最大）
        for f in frames_data:
            k = f["keypoints"]
            knee_mid_y = (k["left_knee"]["y"] + k["right_knee"]["y"]) / 2
            signal.append(float(knee_mid_y))
        invert = False  # 找极大值（背侧倾倒顶点 Y 最大）

    else:
        print(f"   ⚠️ 未知动作类型 {action_type}，跳过切分")
        return []

    signal = np.array(signal)

    # 移动平均平滑
    win = min(5, max(2, len(signal) // 15))
    smoothed = np.convolve(signal, np.ones(win) / win, mode="same")

    # 去均值后找极值
    centered = smoothed - np.mean(smoothed)
    min_dist = max(3, int(SAMPLE_FPS * 1.5))  # 最短周期间距 1.5s

    # prominence 阈值：膝关节旋转幅度通常达画面宽 5%+，用更高阈值避免抖动误切
    # 其他动作保持较低阈值（0.003），膝关节旋转专用 0.01
    if action_type == "knee_rotation":
        prom = 0.01
    else:
        prom = 0.003

    if invert:
        peaks, props = find_peaks(-centered, distance=min_dist, prominence=prom)
    else:
        peaks, props = find_peaks(centered,  distance=min_dist, prominence=prom)

    print(f"   检测到 {len(peaks)} 个动作极值点（{action_type}）")

    if len(peaks) < 1:
        print("   ⚠️ 未检测到有效周期，将整段作为单周期")
        return [{
            "rep_id":           1,
            "start_frame":      0,
            "end_frame":        len(frames_data) - 1,
            "contraction_frame": len(frames_data) // 2,
            "duration_s":       timestamps[-1] - timestamps[0] if timestamps else 0,
        }]

    # ── 非重叠周期切分 ──
    # 方法：在相邻两个极值点之间找信号的谷底（零交叉点）作为周期边界，
    # 确保每一帧只属于一个周期，避免原有「上一峰→下一峰」的重叠问题。
    # 若极值点只有1个，则整段作为单周期（真实动作不足时的降级处理）。
    boundaries = []
    for i in range(len(peaks) - 1):
        # 两个相邻峰之间，找 centered 信号的最低点作为分割边界
        seg = centered[peaks[i]: peaks[i + 1] + 1]
        local_min = int(np.argmin(seg)) + peaks[i]
        boundaries.append(local_min)

    # 构造周期：[段起点, 段终点]
    seg_starts = [0] + boundaries
    seg_ends   = boundaries + [len(frames_data) - 1]

    cycles = []
    for i, peak in enumerate(peaks):
        st  = seg_starts[i]
        en  = seg_ends[i]
        dur = timestamps[en] - timestamps[st]
        if dur < 1.5:
            continue
        cycles.append({
            "rep_id":            len(cycles) + 1,
            "start_frame":       int(st),
            "end_frame":         int(en),
            "contraction_frame": int(peak),
            "duration_s":        round(dur, 2),
        })

    print(f"   有效训练周期: {len(cycles)} 个")
    for c in cycles:
        print(f"   周期 {c['rep_id']}: 帧 {c['start_frame']}~{c['end_frame']}  ({c['duration_s']:.1f}s)")

    return cycles


# ─── Step 4: 参数计算（按动作类型分支）───────────────────────────────────────

def calculate_params(frames_data: list, cycles: list, action_type: str) -> list:
    """
    对每个训练周期计算对应动作类型的代理指标
    """
    import numpy as np

    results = []

    for cycle in cycles:
        st   = cycle["start_frame"]
        en   = cycle["end_frame"]
        peak = cycle["contraction_frame"]

        cf = frames_data[st : en + 1]
        if len(cf) < 4:
            continue

        kps_list = [f["keypoints"]        for f in cf]
        ts_list  = [f["timestamp_ms"] / 1000.0 for f in cf]
        params   = {}

        # ════════════════════════════════════════════
        # 通用参数（三种动作均计算）
        # ════════════════════════════════════════════

        # ── 躯干角度变化 trunk_angle_change ──
        trunk_angles = []
        for kps in kps_list:
            sx = (kps["left_shoulder"]["x"] + kps["right_shoulder"]["x"]) / 2
            sy = (kps["left_shoulder"]["y"] + kps["right_shoulder"]["y"]) / 2
            hx = (kps["left_hip"]["x"]      + kps["right_hip"]["x"])      / 2
            hy = (kps["left_hip"]["y"]      + kps["right_hip"]["y"])      / 2
            dy = sy - hy
            if abs(dy) > 0.001:
                angle = float(np.degrees(np.arctan2(sx - hx, -dy)))
            else:
                angle = 0.0
            trunk_angles.append(angle)
        rest_trunk = np.mean(trunk_angles[:3])
        params["trunk_angle_change"] = round(float(np.max(np.abs(np.array(trunk_angles) - rest_trunk))), 4)

        # ── 骨盆水平偏移 pelvis_shift ──
        # 对于膝关节旋转动作，骨盆偏移信号即为切分信号，此处仍正常计算
        # （pelvis_shift 衡量骨盆在整个周期内的最大偏移量，而非平均位置）
        hip_x_arr = [(kps["left_hip"]["x"] + kps["right_hip"]["x"]) / 2 for kps in kps_list]
        rest_hx   = np.mean(hip_x_arr[:3])
        params["pelvis_shift"] = round(float(np.max(np.abs(np.array(hip_x_arr) - rest_hx))) * 100, 4)

        # ── 保持时长 hold_duration（通用逻辑，按各动作的"保持位"判断）──
        # 使用峰值帧局部±10%幅度内的连续帧数 × 帧时长
        peak_local = min(peak - st, len(kps_list) - 1)
        frame_dur  = (ts_list[-1] - ts_list[0]) / max(1, len(ts_list) - 1)

        # ════════════════════════════════════════════
        # 分动作计算核心指标
        # ════════════════════════════════════════════

        if action_type == "abdominal_crunch":
            # 【改】1. 缩腹质量核心指标：躯干稳定性
            # 物理意义：正确缩腹 = 腹肌向内收缩，躯干保持不动（trunk_angle_change ≈ 0°）
            # 错误代偿 = 躯干前屈替代腹肌发力（trunk_angle_change > 阈值）
            # 此处 trunk_angle_change 已在通用参数块计算，此处额外记录「收缩时」的稳定性
            trunk_arr_cycle = []
            for kps in kps_list:
                sx = (kps["left_shoulder"]["x"] + kps["right_shoulder"]["x"]) / 2
                sy = (kps["left_shoulder"]["y"] + kps["right_shoulder"]["y"]) / 2
                hx = (kps["left_hip"]["x"]      + kps["right_hip"]["x"])      / 2
                hy = (kps["left_hip"]["y"]      + kps["right_hip"]["y"])      / 2
                dy = sy - hy
                a  = float(np.degrees(np.arctan2(sx - hx, -dy + 1e-8)))
                trunk_arr_cycle.append(a)
            rest_trunk_c = np.mean(trunk_arr_cycle[:3])
            trunk_dev    = np.abs(np.array(trunk_arr_cycle) - rest_trunk_c)
            # trunk_stability：周期内躯干角度的平均偏差（越小说明躯干越稳定，动作越正确）
            params["trunk_stability"]    = round(float(np.mean(trunk_dev)), 4)
            params["trunk_max_deviation"] = round(float(np.max(trunk_dev)),  4)

            # 【改】2. 呼吸节律指标：腹部侧面轮廓变化（用左右髋宽度替代 Y 轴位移）
            # 侧面拍摄时：髋宽度（归一化）反映腹围横向变化，比肩髋 Y 轴位移更接近腹壁收缩
            hip_width_arr = [abs(kps["left_hip"]["x"] - kps["right_hip"]["x"]) for kps in kps_list]
            rest_hw       = np.mean(hip_width_arr[:3]) + 1e-8  # 避免除零
            # 相对变化率（正值=髋宽缩小=腹部收缩）
            hw_change     = [(rest_hw - w) / rest_hw for w in hip_width_arr]
            max_hw_change = float(max(hw_change)) if max(hw_change) > 0 else 0.0
            params["abdominal_contraction_ratio"] = round(max_hw_change * 100, 4)  # 单位：%

            # 【改】3. 收缩速度：基于髋宽变化率而非 Y 轴位移
            # 找到髋宽最小帧（收缩顶峰）计算到达时间
            min_hw_idx = int(np.argmin(hip_width_arr))
            ct = ts_list[min_hw_idx] - ts_list[0] if min_hw_idx > 0 else (ts_list[-1] - ts_list[0])
            params["contraction_velocity"] = round(
                params["abdominal_contraction_ratio"] / ct, 4) if ct > 0 else 0.0

            # 【改】4. 保持时长：在最大收缩位（髋宽缩小 60%+）的连续帧时长
            # 使用速度方差法：连续帧间速度 < 阈值的最长连续区间
            hw_vel   = [abs(hip_width_arr[i] - hip_width_arr[i-1]) / (frame_dur + 1e-8)
                        for i in range(1, len(hip_width_arr))]
            vel_thr  = float(np.std(hw_vel)) * 0.5 if len(hw_vel) > 2 else 1e9
            in_hold  = [v <= vel_thr for v in hw_vel]
            # 仅统计处于收缩位（髋宽 < rest_hw）的静止区间
            in_contracted = [w < rest_hw * 0.98 for w in hip_width_arr[1:]]
            in_hold_valid = [h and c for h, c in zip(in_hold, in_contracted)]
            max_h = 0
            cur_h = 0
            for h in in_hold_valid:
                if h:
                    cur_h += 1; max_h = max(max_h, cur_h)
                else:
                    cur_h = 0
            params["hold_duration"] = round(max_h * frame_dur, 2)

        elif action_type == "pelvic_tilt":
            # 1. 骨盆倾斜变化量（双髋连线与水平线夹角）
            tilt_arr = []
            for kps in kps_list:
                dx = kps["right_hip"]["x"] - kps["left_hip"]["x"]
                dy = kps["right_hip"]["y"] - kps["left_hip"]["y"]
                tilt_arr.append(float(np.degrees(np.arctan2(dy, dx + 1e-8))))
            rest_tilt = np.mean(tilt_arr[:3])
            delta_arr = np.abs(np.array(tilt_arr) - rest_tilt)
            params["pelvic_tilt_delta"] = round(float(np.max(delta_arr)), 4)

            # 2. 骨盆倾斜速度
            if peak_local > 0:
                ct = ts_list[peak_local] - ts_list[0]
                params["pelvic_tilt_velocity"] = round(params["pelvic_tilt_delta"] / ct, 4) if ct > 0 else 0.0
            else:
                params["pelvic_tilt_velocity"] = 0.0

            # 3. 保持时长（帧间速度方差法，在最大倾斜位的静止区间）
            tilt_vel = [abs(tilt_arr[i] - tilt_arr[i-1]) / (frame_dur + 1e-8)
                        for i in range(1, len(tilt_arr))]
            vel_thr  = float(np.std(tilt_vel)) * 0.5 if len(tilt_vel) > 2 else 1e9
            # 处于倾斜峰值区（delta ≥ 60% 最大值）且速度低于阈值
            thr          = float(np.max(delta_arr)) * 0.6
            in_peak_zone = [d >= thr for d in delta_arr[1:]]
            in_slow      = [v <= vel_thr for v in tilt_vel]
            in_hold      = [p and s for p, s in zip(in_peak_zone, in_slow)]
            max_h = 0
            cur_h = 0
            for h in in_hold:
                if h:
                    cur_h += 1; max_h = max(max_h, cur_h)
                else:
                    cur_h = 0
            params["hold_duration"] = round(max_h * frame_dur, 2)

        elif action_type == "knee_rotation":
            # ── 正侧面拍摄版膝关节旋转参数计算 ──────────────────────────
            # 侧面视角：膝盖向腹侧/背侧倾倒，Y 轴位移可见；X 轴（头脚方向）几乎不变
            # 双膝在侧面重叠，取左右膝Y坐标均值作为代表

            # 1. knee_y_excursion：双膝中点 Y 轴偏移幅度（归一化坐标×100 → %）
            #    物理含义：膝盖从起始位倒向背侧/腹侧的最大位移，越大说明活动幅度越充分
            knee_y_arr = [
                (kps["left_knee"]["y"] + kps["right_knee"]["y"]) / 2
                for kps in kps_list
            ]
            rest_ky = np.mean(knee_y_arr[:3])
            knee_excursion = float(np.max(np.abs(np.array(knee_y_arr) - rest_ky))) * 100
            params["knee_y_excursion"] = round(knee_excursion, 4)

            # 2. hip_stability：倒膝过程中髋中点 Y 轴抖动量（归一化坐标×100 → %）
            #    物理含义：倒膝时髋部不应随之移动；Y轴变化越大说明骨盆代偿越多
            hip_y_arr = [
                (kps["left_hip"]["y"] + kps["right_hip"]["y"]) / 2
                for kps in kps_list
            ]
            rest_hy = np.mean(hip_y_arr[:3])
            hip_excursion = float(np.max(np.abs(np.array(hip_y_arr) - rest_hy))) * 100
            params["hip_stability"] = round(hip_excursion, 4)

            # trunk_angle_change 已在通用参数块中计算，无需重复

        results.append({
            "rep_id":      cycle["rep_id"],
            "start_frame": st,
            "end_frame":   en,
            "duration_s":  cycle["duration_s"],
            "params":      params,
        })

    print(f"\n   📐 参数计算完成: {len(results)} 个有效周期")
    for r in results:
        print(f"\n   周期 {r['rep_id']} ({r['duration_s']:.1f}s):")
        for k, v in r["params"].items():
            print(f"      {k}: {v}")

    return results


# ─── Step 5: 统计建模 ─────────────────────────────────────────────────────────

def statistical_modeling(cycle_results: list, action_type: str):
    """对所有周期的参数进行统计建模，生成 template_params 和 threshold_config"""
    import numpy as np

    if not cycle_results:
        raise ValueError("没有有效的训练周期数据，无法建模")

    all_params = [r["params"] for r in cycle_results]
    param_names = list(all_params[0].keys())

    template_params = {}
    for pname in param_names:
        values = np.array([p[pname] for p in all_params if pname in p])
        if len(values) == 0:
            continue
        template_params[pname] = {
            "mean":     round(float(np.mean(values)), 4),
            "std":      round(float(np.std(values)),  4),
            "min":      round(float(np.min(values)),  4),
            "max":      round(float(np.max(values)),  4),
            "p5":       round(float(np.percentile(values,  5)), 4),
            "p25":      round(float(np.percentile(values, 25)), 4),
            "p50":      round(float(np.percentile(values, 50)), 4),
            "p75":      round(float(np.percentile(values, 75)), 4),
            "p95":      round(float(np.percentile(values, 95)), 4),
            "n_cycles": int(len(values)),
        }

    threshold_config = generate_thresholds(template_params, action_type)

    print(f"\n   📊 统计建模结果 ({len(cycle_results)} 个周期):")
    for pname, stats in template_params.items():
        print(f"      {pname}: mean={stats['mean']:.4f} ± {stats['std']:.4f}  "
              f"[{stats['min']:.4f}, {stats['max']:.4f}]")

    return template_params, threshold_config


def generate_thresholds(template_params: dict, action_type: str) -> dict:
    """基于统计量生成初始阈值"""
    sigma = SIGMA_MULTIPLIER
    thresholds = {
        "_meta": {
            "sigma_multiplier": sigma,
            "note": f"基于 ±{sigma}σ 自动生成，适用于单视频启动期，建议专家审核后调整",
            "action_type": action_type,
        },
        "confidence_min": 0.6,
    }

    for pname, stats in template_params.items():
        mean = stats["mean"]
        std  = stats["std"]
        meta = PARAM_META.get(pname, {"direction": "moderate", "unit": "", "description": pname})
        direction = meta["direction"]

        if direction == "larger_better":
            valid_range   = [round(mean - sigma * std,       4), round(mean + sigma * 2 * std, 4)]
            warning_range = [round(mean - sigma * 1.5 * std, 4), round(mean + sigma * 3 * std, 4)]
        elif direction == "smaller_better":
            valid_range   = [0, round(mean + sigma * std,       4)]
            warning_range = [0, round(mean + sigma * 2 * std,   4)]
        else:  # moderate / depends
            valid_range   = [round(mean - sigma * std,       4), round(mean + sigma * std,       4)]
            warning_range = [round(mean - sigma * 1.5 * std, 4), round(mean + sigma * 1.5 * std, 4)]

        # smaller_better 的 valid_range 下限不能为负
        if direction == "smaller_better":
            valid_range[0]   = max(0, valid_range[0])
            warning_range[0] = max(0, warning_range[0])

        thresholds[pname] = {
            "valid_range":   valid_range,
            "warning_range": warning_range,
            "gold_mean":     mean,
            "gold_std":      std,
            "unit":          meta["unit"],
            "description":   meta["description"],
            "direction":     direction,
        }

    return thresholds


# ─── Step 6: 生成报告 ─────────────────────────────────────────────────────────

def generate_report(
    quality_report:   dict,
    cycles:           list,
    cycle_results:    list,
    template_params:  dict,
    threshold_config: dict,
    action_type:      str,
    action_label:     str,
    time_range:       tuple,
    source_video_path: Path,
) -> str:
    lines = []
    lines.append("=" * 64)
    lines.append(f"  金标准模板构建报告 — {action_label}（{action_type}）")
    lines.append("=" * 64)
    lines.append(f"\n动作类型:   {action_type}  ({action_label})")
    lines.append(f"视频片段:   {time_range[0]}s ~ {time_range[1]}s")
    lines.append(f"分析时间:   {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"视频路径:   {source_video_path}")

    lines.append("\n── 视频质量 ──────────────────────────────────────────")
    lines.append(f"  总采样帧数:    {quality_report['total_frames']}")
    lines.append(f"  平均置信度:    {quality_report['avg_confidence']:.3f}")
    lines.append(f"  关键点缺失率:  {quality_report['missing_rate']:.1%}")
    lines.append(f"  质量通过:      {'✅ 是' if quality_report['pass'] else '❌ 否（参数仅供参考）'}")
    for w in quality_report.get("warnings", []):
        lines.append(f"  {w}")

    lines.append("\n── 周期切分 ──────────────────────────────────────────")
    lines.append(f"  检测到有效周期数: {len(cycles)}")
    for c in cycles:
        lines.append(f"  周期 {c['rep_id']}: {c['duration_s']:.1f}秒")

    lines.append("\n── 金标准参数 ────────────────────────────────────────")
    for pname, stats in template_params.items():
        thresh = threshold_config.get(pname, {})
        lines.append(f"\n  【{pname}】")
        lines.append(f"    说明:       {thresh.get('description', '')}")
        lines.append(f"    均值:       {stats['mean']:.4f} {thresh.get('unit', '')}")
        lines.append(f"    标准差:     {stats['std']:.4f}")
        lines.append(f"    范围:       [{stats['min']:.4f}, {stats['max']:.4f}]")
        lines.append(f"    P5 / P95:   {stats['p5']:.4f} / {stats['p95']:.4f}")
        if thresh.get("valid_range"):
            vr = thresh["valid_range"]
            lines.append(f"    有效区间（±{SIGMA_MULTIPLIER}σ）: [{vr[0]:.4f}, {vr[1]:.4f}]")
        lines.append(f"    评价方向:   {thresh.get('direction', '-')}")

    lines.append("\n── 使用建议 ──────────────────────────────────────────")
    lines.append(f"  1. 本模板基于 {len(cycles)} 个训练周期（样本量有限，统计不稳定）")
    lines.append(f"  2. 当前使用 {SIGMA_MULTIPLIER}σ 宽松阈值，初期建议保持宽松")
    lines.append(f"  3. 建议由 2-3 名治疗师审核各参数合理性后入库")
    lines.append(f"  4. 积累 ≥30 条患者数据后，校正 gold_mean 至患者群体均值")
    lines.append(f"  5. status 字段为 pending_review，需专家确认后改为 active")
    lines.append("\n" + "=" * 64)

    return "\n".join(lines)


# ─── 主流程 ───────────────────────────────────────────────────────────────────

def process_one_action(
    frames_data:  list,
    action_type:  str,
    action_label: str,
    start_sec:    float,
    end_sec:      float,
    output_root: Path,
    source_video_path: Path,
) -> dict:
    """
    对一段已提取好的帧数据进行完整的金标准构建流程
    返回构建结果 dict，同时写入对应子目录
    """
    print(f"\n{'='*64}")
    print(f"  处理动作: {action_label}（{action_type}）  {start_sec}s ~ {end_sec}s")
    print(f"{'='*64}")

    sub_dir = output_root / action_type
    sub_dir.mkdir(parents=True, exist_ok=True)

    # Step 2: 质量检验
    print("\n🔍 Step 2: 质量检验")
    quality = quality_check(frames_data)

    # Step 3: 周期切分
    print("\n📊 Step 3: 周期切分")
    cycles = segment_phases(frames_data, action_type)

    if not cycles:
        print(f"   ❌ {action_label} 未检测到有效周期，跳过")
        return None

    # Step 4: 参数计算
    print("\n📐 Step 4: 参数计算")
    cycle_results = calculate_params(frames_data, cycles, action_type)

    if not cycle_results:
        print(f"   ❌ {action_label} 参数计算失败，跳过")
        return None

    # 保存 cycle_params.json
    cp_path = sub_dir / "cycle_params.json"
    with open(cp_path, "w", encoding="utf-8") as f:
        json.dump(cycle_results, f, ensure_ascii=False, indent=2)
    print(f"\n   💾 周期参数已保存: {cp_path}")

    # Step 5: 统计建模
    print("\n📊 Step 5: 统计建模")
    template_params, threshold_config = statistical_modeling(cycle_results, action_type)

    # 构建模板
    template = {
        "action_type":   action_type,
        "action_label":  action_label,
        "source_type":   "video",
        "source_video":  source_video_path.name,
        "video_segment": {"start_sec": start_sec, "end_sec": end_sec},
        "version":       1,
        "status":        "pending_review",
        "template_params":  template_params,
        "threshold_config": threshold_config,
        "quality_report": {
            "avg_confidence": quality["avg_confidence"],
            "missing_rate":   quality["missing_rate"],
            "total_frames":   quality["total_frames"],
            "valid_cycles":   len(cycle_results),
            "quality_pass":   quality["pass"],
            "warnings":       quality.get("warnings", []),
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    tpl_path = sub_dir / "template.json"
    with open(tpl_path, "w", encoding="utf-8") as f:
        json.dump(template, f, ensure_ascii=False, indent=2)
    print(f"   💾 金标准模板已保存: {tpl_path}")

    # Step 6: 生成报告
    report_text = generate_report(
        quality, cycles, cycle_results,
        template_params, threshold_config,
        action_type, action_label, (start_sec, end_sec), source_video_path,
    )
    rpt_path = sub_dir / "report.txt"
    with open(rpt_path, "w", encoding="utf-8") as f:
        f.write(report_text)
    print(f"   💾 分析报告已保存: {rpt_path}")
    print("\n" + report_text)

    return template


def _safe_load_json(path: Path):
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _to_number(v):
    if isinstance(v, (int, float)):
        return float(v)
    return None


def build_template_stats_map(template_json: dict) -> dict:
    stats_map = {}
    if not template_json:
        return stats_map
    template_params = template_json.get("template_params", {})
    threshold_config = template_json.get("threshold_config", {})

    for pname, stats in template_params.items():
        mean_v = _to_number(stats.get("mean"))
        std_v = _to_number(stats.get("std"))
        if mean_v is None or std_v is None:
            continue
        threshold_item = threshold_config.get(pname, {}) if isinstance(threshold_config, dict) else {}
        stats_map[pname] = {
            "mean": mean_v,
            "std": std_v,
            "valid_range": threshold_item.get("valid_range"),
            "warning_range": threshold_item.get("warning_range"),
        }
    return stats_map


def compare_templates(existing_template: dict, new_template: dict) -> dict:
    existing_stats = build_template_stats_map(existing_template)
    new_stats = build_template_stats_map(new_template)

    metrics = sorted(set(existing_stats.keys()) | set(new_stats.keys()))
    result = {
        "existing_source_video": existing_template.get("source_video") if existing_template else None,
        "new_source_video": new_template.get("source_video") if new_template else None,
        "metric_diffs": {},
    }

    for metric in metrics:
        old_item = existing_stats.get(metric)
        new_item = new_stats.get(metric)
        metric_entry = {
            "existing": old_item,
            "new": new_item,
        }

        if old_item and new_item:
            delta_mean = new_item["mean"] - old_item["mean"]
            delta_std = new_item["std"] - old_item["std"]
            mean_change_ratio = None
            if abs(old_item["mean"]) > 1e-8:
                mean_change_ratio = delta_mean / old_item["mean"]
            metric_entry["delta_mean"] = round(delta_mean, 6)
            metric_entry["delta_std"] = round(delta_std, 6)
            metric_entry["mean_change_ratio"] = round(mean_change_ratio, 6) if mean_change_ratio is not None else None

        result["metric_diffs"][metric] = metric_entry

    return result


def write_comparison_report(comparison_summary: dict, output_path: Path):
    lines = []
    lines.append("=" * 72)
    lines.append("追加标准视频 vs 历史金标准 对比报告")
    lines.append("=" * 72)

    for action_type, payload in comparison_summary.items():
        lines.append(f"\n[{action_type}] {payload.get('action_label', '')}")
        lines.append(f"  历史视频: {payload.get('existing_source_video')}")
        lines.append(f"  新增视频: {payload.get('new_source_video')}")
        lines.append("  参数对比:")
        metric_diffs = payload.get("metric_diffs", {})
        for metric, diff in metric_diffs.items():
            old_item = diff.get("existing")
            new_item = diff.get("new")
            if not old_item:
                lines.append(f"    - {metric}: 仅新增模板存在")
                continue
            if not new_item:
                lines.append(f"    - {metric}: 仅历史模板存在")
                continue

            delta_mean = diff.get("delta_mean")
            delta_std = diff.get("delta_std")
            ratio = diff.get("mean_change_ratio")
            ratio_text = "-"
            if ratio is not None:
                ratio_text = f"{ratio * 100:.2f}%"
            lines.append(
                f"    - {metric}: mean {old_item['mean']:.4f} -> {new_item['mean']:.4f} "
                f"(Δ {delta_mean:+.4f}, {ratio_text}), std {old_item['std']:.4f} -> {new_item['std']:.4f} "
                f"(Δ {delta_std:+.4f})"
            )

    lines.append("\n" + "=" * 72)
    lines.append(f"生成时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    print("=" * 64)
    print("  自助腹肌训练系统 · 标准视频追加金标准提取")
    print("=" * 64)

    check_dependencies()

    OUTPUT_DIR.mkdir(exist_ok=True)
    APPEND_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results_summary = {}
    comparison_summary = {}

    for source in NEW_STANDARD_VIDEO_SOURCES:
        action_type = source["action_type"]
        action_label = source["action_label"]
        video_path = source["video_path"]

        print("\n" + "=" * 64)
        print(f"  处理新增视频: {action_label}（{action_type}）")
        print("=" * 64)

        if not video_path.exists():
            print(f"❌ 未找到新增标准视频: {video_path}")
            continue

        print(f"✅ 找到新增标准视频: {video_path} ({video_path.stat().st_size / 1024 / 1024:.1f} MB)")

        try:
            import cv2
            cap = cv2.VideoCapture(str(video_path))
            orig_fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            total_dur = total_frames / orig_fps if orig_fps > 0 else 0
            cap.release()
            print(f"   视频信息: {total_dur:.1f}s  |  {orig_fps:.1f}fps  |  {total_frames}帧")
        except Exception:
            total_dur = 0

        print("\n  Step 1: 提取完整视频关键点")
        all_frames = extract_keypoints(video_path)

        kp_path = APPEND_OUTPUT_DIR / action_type / "raw_keypoints.json"
        kp_path.parent.mkdir(parents=True, exist_ok=True)
        with open(kp_path, "w", encoding="utf-8") as f:
            json.dump(all_frames, f, ensure_ascii=False, indent=2)
        print(f"💾 新增视频关键点已保存: {kp_path}  ({len(all_frames)} 帧)")

        if len(all_frames) < 8:
            print(f"   ⚠️ 帧数不足（{len(all_frames)} 帧），跳过 {action_label}")
            continue

        result = process_one_action(
            all_frames,
            action_type,
            action_label,
            0,
            round(float(total_dur), 2),
            APPEND_OUTPUT_DIR,
            video_path,
        )
        if not result:
            continue

        template_path = APPEND_OUTPUT_DIR / action_type / "template.json"
        existing_template_path = BASELINE_TEMPLATE_DIR / action_type / "template.json"
        existing_template = _safe_load_json(existing_template_path) or {}
        new_template = _safe_load_json(template_path) or {}
        comparison = compare_templates(existing_template, new_template)
        comparison["action_label"] = action_label

        comparison_summary[action_type] = comparison
        results_summary[action_type] = {
            "label": action_label,
            "valid_cycles": result["quality_report"]["valid_cycles"],
            "quality_pass": result["quality_report"]["quality_pass"],
            "template_path": str(template_path),
            "comparison_base": str(existing_template_path),
        }

    with open(APPEND_COMPARE_JSON, "w", encoding="utf-8") as f:
        json.dump(comparison_summary, f, ensure_ascii=False, indent=2)
    write_comparison_report(comparison_summary, APPEND_COMPARE_TXT)

    print("\n" + "=" * 64)
    print("  ✅ 追加处理完成 · 汇总")
    print("=" * 64)
    for _, info in results_summary.items():
        q_icon = "✅" if info["quality_pass"] else "⚠️"
        print(
            f"  {q_icon} {info['label']:8s}  有效周期 {info['valid_cycles']} 个"
            f"  →  {info['template_path']}"
        )
        print(f"      对比基线: {info['comparison_base']}")

    print(f"\n📁 新增模板目录: {APPEND_OUTPUT_DIR}")
    print(f"📊 对比JSON: {APPEND_COMPARE_JSON}")
    print(f"📝 对比文本报告: {APPEND_COMPARE_TXT}")
    print("\n下一步：结合对比报告审核新增模板，如确认可用再入库为新版本。")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ 用户中断")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ 运行出错: {e}")
        traceback.print_exc()
        sys.exit(1)
