"""Step 6: 金标准模板比对"""

import logging
import math
from typing import Dict, List

from app.core.models import CompareResult
from app.core.constants import DEFAULT_TEMPLATES, DEFAULT_THRESHOLDS

logger = logging.getLogger(__name__)


class GoldStandardComparator:
    """
    对每个参数与金标准统计值进行比对，输出偏差等级
    """

    def __init__(self, action_type: str, threshold_config: Dict = None):
        self.action_type = action_type
        self.template = DEFAULT_TEMPLATES.get(action_type, {})
        self.thresholds = threshold_config or DEFAULT_THRESHOLDS.copy()
        self.sigma_multiplier = self.thresholds.get('sigma_multiplier', 1.5)

    def compare_feature(self, feature_code: str, measured_value: float) -> CompareResult:
        """
        比对逻辑：
        1. 优先检查 valid_range（专家设定的绝对阈值区间）
        2. 计算与均值的偏差 σ = |measured - mean| / std
        3. 综合判定标签
        """
        ref = self.template.get(feature_code)
        if not isinstance(measured_value, (int, float)) or not math.isfinite(measured_value):
            return CompareResult(
                feature_code=feature_code,
                measured=0.0,
                reference_mean=0.0,
                reference_std=0.0,
                deviation_sigma=0.0,
                label='review_required',
                in_valid_range=False,
            )
        if ref is None or not isinstance(ref.get('mean'), (int, float)) or not isinstance(ref.get('std'), (int, float)):
            # 缺失或不完整金标准不能被视为正常：保留原始值，标记为待人工复核。
            return CompareResult(
                feature_code=feature_code,
                measured=measured_value,
                reference_mean=0.0,
                reference_std=0.0,
                deviation_sigma=0.0,
                label='review_required',
                in_valid_range=False,
            )

        reference_mean = ref['mean']
        reference_std = ref['std']

        # 模板的统计值与阈值配置分离：评分语义必须优先读取版本化阈值，
        # 以确保“越大/越小越好”的业务方向能随模板版本一起生效。
        param_threshold = self.thresholds.get(feature_code, {})
        if not isinstance(param_threshold, dict):
            param_threshold = {}
        scoring_mode = param_threshold.get('scoring_mode', ref.get('scoring_mode', 'two_sided'))

        if scoring_mode == 'upper_bound':
            normal_max = float(param_threshold.get('normal_max', ref.get('normal_max', reference_mean)))
            warning_max = float(param_threshold.get('warning_max', ref.get('warning_max', normal_max + max(reference_std, 1e-6))))
            deviation_sigma = max(0.0, measured_value - normal_max) / max(reference_std, 1e-6)
            in_valid_range = measured_value <= normal_max
            if measured_value <= normal_max:
                label = 'normal'
            elif measured_value <= warning_max:
                label = 'warning'
            else:
                label = 'invalid'
        elif scoring_mode == 'lower_bound':
            normal_min = float(param_threshold.get('normal_min', reference_mean))
            warning_min = float(param_threshold.get('warning_min', normal_min - max(reference_std, 1e-6)))
            deviation_sigma = max(0.0, normal_min - measured_value) / max(reference_std, 1e-6)
            in_valid_range = measured_value >= normal_min
            if measured_value >= normal_min:
                label = 'normal'
            elif measured_value >= warning_min:
                label = 'warning'
            else:
                label = 'invalid'
        else:
            if reference_std > 0:
                deviation_sigma = abs(measured_value - reference_mean) / reference_std
            else:
                deviation_sigma = 0.0 if abs(measured_value - reference_mean) < 1e-6 else 999.0

            valid_range = param_threshold.get('valid_range')
            warning_range = param_threshold.get('warning_range')
            has_versioned_ranges = (
                isinstance(valid_range, (list, tuple)) and len(valid_range) == 2
                and isinstance(warning_range, (list, tuple)) and len(warning_range) == 2
            )
            in_valid_range = not valid_range or valid_range[0] <= measured_value <= valid_range[1]
            in_warning_range = not warning_range or warning_range[0] <= measured_value <= warning_range[1]
            if has_versioned_ranges:
                # 新模板以其保存的 normal/warning 区间为唯一事实来源，避免 σ 被重复收紧。
                if in_valid_range:
                    label = 'normal'
                elif in_warning_range:
                    label = 'warning'
                else:
                    label = 'invalid'
            elif in_valid_range and deviation_sigma < self.sigma_multiplier:
                # 兼容历史模板：历史版本只有全局 σ 倍数，没有逐项门限配置。
                label = 'normal'
            elif (in_warning_range or in_valid_range) and deviation_sigma < 2.5:
                label = 'warning'
            else:
                label = 'invalid'

        return CompareResult(
            feature_code=feature_code,
            measured=measured_value,
            reference_mean=reference_mean,
            reference_std=reference_std,
            deviation_sigma=deviation_sigma,
            label=label,
            in_valid_range=in_valid_range,
        )

    def compare_all(self, params: Dict[str, float]) -> List[CompareResult]:
        """对所有参数进行金标准比对"""
        results = []
        for feature_code, value in params.items():
            result = self.compare_feature(feature_code, value)
            results.append(result)
            logger.debug('Compare %s: measured=%.2f, mean=%.2f, sigma=%.2f, label=%s',
                         feature_code, value, result.reference_mean,
                         result.deviation_sigma, result.label)
        return results
