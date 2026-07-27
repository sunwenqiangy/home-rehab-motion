"""Step 6: 金标准模板比对"""

import logging
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

        # 计算偏差 σ
        if reference_std > 0:
            deviation_sigma = abs(measured_value - reference_mean) / reference_std
        else:
            deviation_sigma = 0.0 if abs(measured_value - reference_mean) < 1e-6 else 999.0

        # 检查 valid_range
        param_threshold = self.thresholds.get(feature_code, {})
        valid_range = param_threshold.get('valid_range')
        warning_range = param_threshold.get('warning_range')

        in_valid_range = True
        if valid_range:
            in_valid_range = valid_range[0] <= measured_value <= valid_range[1]

        in_warning_range = True
        if warning_range:
            in_warning_range = warning_range[0] <= measured_value <= warning_range[1]

        # 综合判定标签
        if in_valid_range and deviation_sigma < self.sigma_multiplier:
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
