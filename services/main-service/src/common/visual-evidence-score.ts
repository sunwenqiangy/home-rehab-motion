/** 仅将经原视频复算回填的旧记录试算用于报告展示；新影子模式不对患者公开。 */
export function getVisualEvidencePreviewScore(snapshot: Record<string, unknown> | undefined, expectedReps: number): number | undefined {
  if (snapshot?.score_type !== 'visual_practice' || !Number.isInteger(expectedReps) || expectedReps < 1) return undefined;
  // 影子模式仅供后台对照。旧记录经原视频复算回填的预览不带该模式，继续兼容其已验证展示。
  if (snapshot.score_mode === 'evidence_shadow') return undefined;
  const raw = snapshot.visual_evidence_preview;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const preview = raw as Record<string, unknown>;
  const score = preview.average_score;
  if (preview.version !== 'abdominal_visual_evidence_v1' || preview.score_available !== true
      || !Array.isArray(preview.rep_scores) || preview.rep_scores.length !== expectedReps
      || typeof score !== 'number' || !Number.isFinite(score) || score < 70 || score > 100) return undefined;
  if (!preview.rep_scores.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 70 && value <= 100)) {
    return undefined;
  }
  const repScores = preview.rep_scores as number[];
  const mean = repScores.reduce((sum, value) => sum + value, 0) / repScores.length;
  if (Math.abs(mean - score) > 0.11) return undefined;
  return score;
}
