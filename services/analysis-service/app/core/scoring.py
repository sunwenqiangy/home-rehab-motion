"""Step 7: 评分引擎与建议生成"""

import logging
from typing import Dict, List

from app.core.models import CompareResult, RepScore, VideoScore
from app.core.constants import ADVICE_RULES, ANALYSIS_VERSION, DEFAULT_WEIGHTS, FEATURE_DIMENSIONS

logger = logging.getLogger(__name__)


def resolve_grade(score: float) -> str:
    """连续阈值映射，避免 89.1~89.9 这类小数落入空档。"""
    if score >= 90:
        return '优秀'
    if score >= 75:
        return '合格'
    if score >= 60:
        return '需改进'
    return '无效'


class ScoringEngine:
    """四维加权评分引擎"""

    def __init__(self, weights: Dict[str, float] = None):
        self.weights = weights or DEFAULT_WEIGHTS.copy()

    def score_rep(
        self,
        rep_id: int,
        compare_results: List[CompareResult],
        action_type: str,
    ) -> RepScore:
        """按动作特征映射计算可解释的四维分，并对可用维度重新归一化权重。"""
        feature_dimensions = FEATURE_DIMENSIONS.get(action_type, {})
        dimension_scores: Dict[str, List[float]] = {}
        compensation_types = []

        review_required = any(cr.label == 'review_required' for cr in compare_results)
        for cr in compare_results:
            dimension = feature_dimensions.get(cr.feature_code)
            if not dimension or cr.label == 'review_required':
                continue
            if cr.label == 'normal':
                score = max(85, 100 - cr.deviation_sigma * 5)
            elif cr.label == 'warning':
                score = max(60, 80 - cr.deviation_sigma * 10)
                compensation_types.append(cr.feature_code)
            else:
                score = max(0, 50 - cr.deviation_sigma * 10)
                compensation_types.append(cr.feature_code)
            dimension_scores.setdefault(dimension, []).append(score)

        if review_required or not dimension_scores:
            return RepScore(
                rep_id=rep_id,
                accuracy_score=0, stability_score=0,
                control_score=0, duration_score=0,
                total_score=0, grade='待复核' if review_required else '无效',
                valid_flag=False, compensation_types=compensation_types + (['template_incomplete'] if review_required else []),
            )

        resolved_scores = {
            dimension: sum(scores) / len(scores)
            for dimension, scores in dimension_scores.items()
        }
        available_weight = sum(self.weights[dimension] for dimension in resolved_scores)
        total_score = sum(
            resolved_scores[dimension] * self.weights[dimension] / available_weight
            for dimension in resolved_scores
        )
        fallback_score = total_score
        accuracy_score = resolved_scores.get('accuracy', fallback_score)
        stability_score = resolved_scores.get('stability', fallback_score)
        control_score = resolved_scores.get('control', fallback_score)
        duration_score = resolved_scores.get('duration', fallback_score)

        # 判定等级
        grade = resolve_grade(total_score)

        # 核心幅度无效时限幅：当 accuracy 维度的特征被判 invalid 时，
        # 说明动作幅度严重不足（如缩腹视频跑骨盆分析），此时即使其他维度
        # 全部正常也不应给出高分，硬限幅到 40 分。
        accuracy_features = [fc for fc, dim in feature_dimensions.items() if dim == 'accuracy']
        accuracy_invalid = any(
            cr.feature_code in accuracy_features and cr.label == 'invalid'
            for cr in compare_results
        )
        if accuracy_invalid and total_score > 40:
            total_score = 40.0
            grade = resolve_grade(total_score)

        # valid_flag: 所有参数不为 invalid
        valid_flag = all(cr.label != 'invalid' for cr in compare_results)

        return RepScore(
            rep_id=rep_id,
            accuracy_score=round(accuracy_score, 1),
            stability_score=round(stability_score, 1),
            control_score=round(control_score, 1),
            duration_score=round(duration_score, 1),
            total_score=round(total_score, 1),
            grade=grade,
            valid_flag=valid_flag,
            compensation_types=compensation_types,
        )

    def aggregate_video_score(
        self,
        video_id: int,
        rep_scores: List[RepScore],
        confidence_score: float = 0.8,
    ) -> VideoScore:
        """
        视频级汇总
        """
        if not rep_scores:
            return VideoScore(
                video_id=video_id, total_reps=0, valid_reps=0,
                average_score=0, grade='无效',
                accuracy_avg=0, stability_avg=0, control_avg=0, duration_avg=0,
                avg_hold_duration=0, confidence_score=confidence_score,
                analysis_version=ANALYSIS_VERSION,
            )

        total_reps = len(rep_scores)
        valid_reps = sum(1 for rs in rep_scores if rs.valid_flag)

        accuracy_avg = sum(rs.accuracy_score for rs in rep_scores) / total_reps
        stability_avg = sum(rs.stability_score for rs in rep_scores) / total_reps
        control_avg = sum(rs.control_score for rs in rep_scores) / total_reps
        duration_avg = sum(rs.duration_score for rs in rep_scores) / total_reps
        average_score = sum(rs.total_score for rs in rep_scores) / total_reps
        avg_hold_duration = sum(rs.hold_duration for rs in rep_scores) / total_reps

        # 总体等级
        grade = resolve_grade(average_score)

        # 生成建议
        main_issues, advice_summary = generate_advice(rep_scores, confidence_score)

        return VideoScore(
            video_id=video_id,
            total_reps=total_reps,
            valid_reps=valid_reps,
            average_score=round(average_score, 1),
            grade=grade,
            accuracy_avg=round(accuracy_avg, 1),
            stability_avg=round(stability_avg, 1),
            control_avg=round(control_avg, 1),
            duration_avg=round(duration_avg, 1),
            avg_hold_duration=round(avg_hold_duration, 2),
            main_issues=main_issues,
            advice_summary=advice_summary,
            confidence_score=round(confidence_score, 3),
            analysis_version=ANALYSIS_VERSION,
        )


def generate_advice(rep_scores: List[RepScore],
                     confidence_score: float) -> tuple:
    """
    根据评价结果生成建议（参数触发 + 规则模板）
    """
    main_issues = []
    advice_summary = []
    triggered_rules = set()

    # 收集所有代偿类型
    for rs in rep_scores:
        for ct in rs.compensation_types:
            main_issues.append({'feature': ct, 'label': 'warning'})

    # 限制最多 2 个主要问题
    main_issues = main_issues[:2]

    # 规则触发
    for rule_code, rule in ADVICE_RULES.items():
        trigger = rule.get('trigger', {})

        # 置信度规则
        if 'confidence_level' in trigger:
            level = trigger['confidence_level']
            if level == 'medium' and 0.55 <= confidence_score < 0.75:
                if rule_code not in triggered_rules:
                    advice_summary.append({
                        'advice_code': rule_code,
                        'patient_text': rule['patient_text'],
                        'nurse_text': rule['nurse_text'],
                    })
                    triggered_rules.add(rule_code)

        # 特征规则
        if 'feature' in trigger:
            feature = trigger['feature']
            labels = trigger.get('label', [])
            for rs in rep_scores:
                if feature in rs.compensation_types:
                    if rule_code not in triggered_rules:
                        advice_summary.append({
                            'advice_code': rule_code,
                            'patient_text': rule['patient_text'],
                            'nurse_text': rule['nurse_text'],
                        })
                        triggered_rules.add(rule_code)
                    break

    return main_issues, advice_summary
