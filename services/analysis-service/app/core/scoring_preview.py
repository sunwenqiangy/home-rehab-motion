"""流程验证用缩腹视觉边界评分试算；不写回正式结果。"""

from typing import Any, Dict, List

from app.core.calculators import get_calculator
from app.core.comparator import GoldStandardComparator
from app.core.constants import DEFAULT_TEMPLATES, DEFAULT_THRESHOLDS
from app.core.models import Frame, Rep
from app.core.scoring import ScoringEngine
from app.core.scoring_contract import assess_scoring_contract


def preview_abdominal_reps(
    frames: List[Frame],
    reps: List[Rep],
    sample_fps: float,
    reference_stats: Dict[str, Any],
    threshold_config: Dict[str, Any],
) -> Dict[str, Any]:
    """只试算视觉算法接受的完整周期；返回可比性，不等同于临床质量结论。"""
    contract = assess_scoring_contract('abdominal_crunch', threshold_config)
    result: Dict[str, Any] = {
        'candidate_count': len(reps),
        'template_comparable': contract['compatible'],
        'score_status': ('comparable' if contract['compatible'] else 'provisional_incompatible_template'),
        'reps': [],
        'average_score': None,
    }
    if not reps:
        return result

    template = {code: dict(stats) for code, stats in DEFAULT_TEMPLATES['abdominal_crunch'].items()}
    for code, stats in (reference_stats or {}).items():
        if isinstance(stats, dict):
            template[code] = {**template.get(code, {}), **stats}
    thresholds = {**DEFAULT_THRESHOLDS, **(threshold_config or {})}
    comparator = GoldStandardComparator('abdominal_crunch', threshold_config=thresholds)
    comparator.template = template
    calculator = get_calculator('abdominal_crunch')
    engine = ScoringEngine()
    parameters = calculator.calculate(frames, reps, sample_fps=sample_fps)

    for rep in reps:
        measured = parameters.get(f'rep_{rep.id}', {})
        comparisons = comparator.compare_all(measured)
        score = engine.score_rep(rep.id, comparisons, 'abdominal_crunch')
        result['reps'].append({
            'rep_id': rep.id,
            'start_time': round(frames[rep.start_frame].timestamp, 3),
            'end_time': round(frames[rep.end_frame].timestamp, 3),
            'score': score.total_score,
            'grade': score.grade,
            'valid': score.valid_flag,
            'dimensions': {
                'accuracy': score.accuracy_score,
                'stability': score.stability_score,
                'control': score.control_score,
                'duration': score.duration_score,
            },
            'features': {
                comparison.feature_code: {
                    'value': round(comparison.measured, 4),
                    'label': comparison.label,
                }
                for comparison in comparisons
            },
        })
    result['average_score'] = round(sum(rep['score'] for rep in result['reps']) / len(result['reps']), 1)
    return result
