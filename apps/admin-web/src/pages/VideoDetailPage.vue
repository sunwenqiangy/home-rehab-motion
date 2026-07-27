<template>
  <div class="admin-page video-detail-page">
    <section class="page-hero compact-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Clinical Video Review</div>
          <h1 class="page-hero__title">训练视频 · #{{ detail?.videoId || '-' }}</h1>
          <p class="page-hero__subtitle">{{ detail?.patientName || '未命名患者' }} · {{ actionTypeLabel(detail?.actionType) }} · {{ detail?.uploadedAt || '等待上传记录' }}</p>
          <div class="page-hero__meta">
            <span class="page-pill">{{ statusLabel(detail?.status) }}</span>
            <span class="page-pill">{{ qualityLabel(detail?.qualityStatus) }}</span>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card hero-glass-card--compact">
            <div class="hero-glass-card__label">本次处理建议</div>
            <div class="hero-glass-card__value">{{ primaryAction }}</div>
            <div class="hero-glass-card__hint">{{ needsManualReview ? '建议人工复核' : '暂不需要人工复核' }}</div>
          </div>
        </div>
      </div>
    </section>

    <div class="toolbar-group compact-toolbar">
      <el-button @click="router.push('/videos')">返回列表</el-button>
      <el-button type="primary" @click="loadPage" :loading="loading">刷新结果</el-button>
    </div>

    <section class="compact-kpi-grid" v-loading="loading">
      <article class="compact-kpi-card">
        <span>综合评分</span><strong>{{ displayScore }}</strong><small>{{ scoreInterpretation }}</small>
      </article>
      <article class="compact-kpi-card">
        <span>有效动作</span><strong>{{ analysisSummary.validRepsText }}</strong><small>有效动作 / 检测动作</small>
      </article>
      <article class="compact-kpi-card">
        <span>需关注项</span><strong :class="{ 'is-warning': concernCount > 0 }">{{ concernCount }}</strong><small>{{ concernCount > 0 ? '建议查看异常动作' : '未发现明显异常' }}</small>
      </article>
    </section>

    <el-card class="surface-card result-card" shadow="never" v-loading="analysisDetailLoading">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">核心结果解读</div>
            <div class="section-header__subtitle">用于快速判断本次训练是否可用、问题在哪里、下一步如何处理。</div>
          </div>
          <el-tag :type="clinicalDecision.type" effect="light">{{ clinicalDecision.title }}</el-tag>
        </div>
      </template>

      <div class="result-summary-row">
        <div class="score-summary">
          <span>本次评分</span>
          <strong>{{ displayScore }}</strong>
          <small>{{ detail?.grade || analysisDetail?.summary?.grade || '-' }}</small>
        </div>
        <div class="result-facts">
          <div><span>主要问题</span><strong>{{ analysisSummary.issueText }}</strong></div>
          <div><span>视频质量</span><strong>{{ qualityLabel(detail?.qualityStatus) }}{{ detail?.qualityScore === null || detail?.qualityScore === undefined ? '' : ` · ${detail.qualityScore}` }}</strong></div>
          <div><span>识别可信度</span><strong>{{ analysisSummary.confidenceText }}</strong></div>
          <div><span>建议处理</span><strong>{{ primaryAction }}</strong></div>
        </div>
      </div>

      <div class="dimension-section">
        <div class="dimension-section__head"><strong>动作表现维度</strong><span>分数越高表示表现越稳定</span></div>
        <div v-for="item in dimensionScores" :key="item.label" class="dimension-row">
          <span>{{ item.label }}</span>
          <div class="dimension-row__bar"><i :style="{ width: `${item.value}%` }" :class="item.tone" /></div>
          <strong>{{ item.display }}</strong>
        </div>
      </div>

      <div class="recommendation-box">
        <div><strong>医护建议：</strong>{{ clinicalDecision.description }}</div>
        <div v-if="analysisSummary.topRepText !== '-'" class="recommendation-box__hint">建议复核片段：{{ analysisSummary.topRepText }}；可在下方骨架视图定位查看。</div>
      </div>
    </el-card>

    <section class="review-section">
      <div class="review-section__bar">
        <div>
          <div class="review-section__title">动作复核</div>
          <div class="review-section__subtitle">可按需加载原视频与骨架同步视图；关键点尚未生成时会明确提示原因。</div>
        </div>
        <div class="review-section__actions">
          <el-button v-if="showReview" size="small" @click="showReview = false">隐藏复核区</el-button>
          <el-button size="small" type="primary" @click="toggleReview" :loading="keypointsLoading">
            {{ keypointsLoading ? '正在加载骨架…' : showReview ? '重新加载骨架' : keypointsData ? '显示复核区' : '加载骨架复核' }}
          </el-button>
        </div>
      </div>
      <el-card v-if="showReview" class="surface-card skeleton-card" shadow="never" v-loading="keypointsLoading">
        <template v-if="keypointsData?.frames?.length">
          <SkeletonOverlay :videoUrl="videoPreviewUrl" :keypointsData="keypointsData" :summaryTotalReps="analysisDetail?.summary?.totalReps ?? 0" :summaryValidReps="analysisDetail?.summary?.validReps ?? 0" />
        </template>
        <div v-else class="skeleton-unavailable">
          <div class="skeleton-unavailable__icon">骨</div>
          <div><strong>{{ keypointsData?.message || '尚未获取到关键点数据' }}</strong><span>骨架复核需要分析服务输出逐帧人体关键点；可在分析完成后重新加载。</span></div>
          <el-button type="primary" plain size="small" :loading="keypointsLoading" @click="loadKeypoints">重新加载</el-button>
        </div>
      </el-card>
    </section>

    <el-card v-if="detail?.status === 'completed'" class="surface-card manual-review-card" shadow="never">
      <template #header>
        <div class="section-header"><div><div class="section-header__title">人工复核结论</div><div class="section-header__subtitle">原始算法结果将独立保留，用于后续准确率与评分偏差评估。</div></div><el-tag v-if="manualReview" :type="manualReview.useManualResult ? 'warning' : 'success'">{{ manualReview.useManualResult ? '患者采用人工修正' : '患者沿用算法结果' }}</el-tag></div>
      </template>
      <div v-if="manualReview" class="review-saved"><strong>已由 {{ manualReview.reviewerName || '医护人员' }} 于 {{ manualReview.reviewedAt }} 完成复核</strong><span>算法判断：{{ reviewJudgmentLabel(manualReview.accuracyJudgment) }} · 处置：{{ reviewDispositionLabel(manualReview.disposition) }}</span><span v-if="manualReview.useManualResult">最终评分：{{ manualReview.manualScore }} 分（{{ manualReview.manualGrade }}）</span><span v-if="manualReview.manualAdvice">医护建议：{{ manualReview.manualAdvice }}</span></div>
      <div v-else class="manual-review-simple">
        <div class="manual-review-simple__intro"><strong>复核后，算法结论是否可直接采用？</strong><span>确认后仅留存算法快照与复核记录，不需要填写其他信息。</span></div>
        <div class="manual-review-simple__actions"><el-button type="primary" :loading="manualReviewSaving" @click="confirmAlgorithmResult">确认算法结果</el-button><el-button @click="openCorrection">需要修正</el-button></div>
        <el-form v-if="showCorrectionForm" label-position="top" class="manual-review-form manual-review-form--correction">
          <div class="manual-review-form__head"><strong>人工修正</strong><span>只填写需要变更的内容；患者端将采用此结果。</span></div>
          <div class="manual-review-correction">
          <el-form-item label="最终评分"><el-input :model-value="reviewForm.manualScore === null ? '' : String(reviewForm.manualScore)" inputmode="numeric" placeholder="请输入 0–100 的整数" @update:model-value="updateManualScore" /></el-form-item>
          <el-form-item label="主要问题"><el-input v-model="reviewForm.manualIssuesText" placeholder="用逗号分隔，例如：骨盆稳定性不足, 动作持续度不足" /></el-form-item>
        </div>
          <el-form-item label="给患者的训练建议"><el-input v-model="reviewForm.manualAdvice" type="textarea" :rows="2" placeholder="建议填写；将直接显示在患者报告中" /></el-form-item>
          <div class="manual-review-form__advanced"><el-checkbox v-model="showReviewNote">补充算法评估备注（仅管理端）</el-checkbox><el-input v-if="showReviewNote" v-model="reviewForm.reviewNote" type="textarea" :rows="2" placeholder="记录本次算法偏差或复核依据" /></div>
          <div class="manual-review-form__footer"><el-button type="primary" :loading="manualReviewSaving" @click="submitManualReview">保存人工修正</el-button><el-button @click="showCorrectionForm = false">取消</el-button></div>
        </el-form>
      </div>
    </el-card>

    <div class="detail-cards">
      <el-card class="surface-card detail-card" shadow="never">
        <template #header><span class="collapse-title">基础信息与任务状态 <small>用于归档和排障</small></span></template>
        <div class="basic-info-grid">
          <div><span>动作类型</span><strong>{{ actionTypeLabel(detail?.actionType) }}</strong></div>
          <div><span>患者</span><strong>{{ detail?.patientName || '-' }}</strong></div>
          <div><span>上传时间</span><strong>{{ detail?.uploadedAt || '-' }}</strong></div>
          <div><span>分析状态</span><strong>{{ statusLabel(detail?.status) }}</strong></div>
          <div><span>任务状态</span><strong>{{ detail?.taskStatus || '-' }}</strong></div>
          <div><span>异常原因</span><strong>{{ detail?.failReason || '无' }}</strong></div>
        </div>
      </el-card>
      <el-card class="surface-card detail-card" shadow="never">
        <template #header><span class="collapse-title">算法与评分明细 <small>用于解释评分与复核算法</small></span></template>
        <div v-if="analysisDetail" class="analysis-detail-grid">
          <div><span>评分权重</span><strong>准确 {{ analysisDetail.scoringExplain.weights.accuracy }} · 稳定 {{ analysisDetail.scoringExplain.weights.stability }} · 控制 {{ analysisDetail.scoringExplain.weights.control }} · 持续 {{ analysisDetail.scoringExplain.weights.duration }}</strong></div>
          <div><span>有效动作占比</span><strong>{{ analysisSummary.validRateText }}</strong></div>
          <div><span>平均保持时长</span><strong>{{ averageHoldText }}</strong></div>
          <div><span>首个异常特征</span><strong>{{ analysisSummary.issueText }}</strong></div>
        </div>
        <el-empty v-else description="暂无分析明细" :image-size="54" />
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getAdminVideoAnalysisDetail, getAdminVideoDetail, getAdminVideoKeypoints, getManualVideoReview, saveManualVideoReview, type AdminVideoAnalysisDetail, type AdminVideoDetail, type KeypointsData } from '@/services/video';
import type { ManualVideoReviewDto, SaveManualVideoReviewRequestDto } from '@home-rehab-motion/shared-contract';
import { ElMessage } from 'element-plus';
import SkeletonOverlay from '@/components/SkeletonOverlay.vue';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';

const route = useRoute();
const router = useRouter();
const detail = ref<AdminVideoDetail | null>(null);
const analysisDetail = ref<AdminVideoAnalysisDetail | null>(null);
const keypointsData = ref<KeypointsData | null>(null);
const loading = ref(false);
const analysisDetailLoading = ref(false);
const keypointsLoading = ref(false);
const showReview = ref(false);
const manualReview = ref<ManualVideoReviewDto | null>(null);
const manualReviewSaving = ref(false);
const showCorrectionForm = ref(false);
const showReviewNote = ref(false);
const reviewForm = ref({ accuracyJudgment: 'inaccurate' as SaveManualVideoReviewRequestDto['accuracyJudgment'], disposition: 'manual_correction' as SaveManualVideoReviewRequestDto['disposition'], useManualResult: true, manualScore: null as number | null, manualIssuesText: '', manualAdvice: '', reviewNote: '' });

const videoPreviewUrl = computed(() => {
  const url = detail.value?.videoPreviewUrl || '';
  return url ? (url.startsWith('http') ? url : `${window.location.origin}${url}`) : null;
});
const analysisSummary = computed(() => {
  const summary = analysisDetail.value?.summary;
  if (!summary) return { validRepsText: '-', validRateText: '-', confidenceText: '-', issueText: '等待分析结果', topRepText: '-' };
  const validRate = summary.totalReps > 0 ? Math.round(summary.validReps / summary.totalReps * 100) : 0;
  const topRep = [...analysisDetail.value.repScores].filter((item) => item.totalScore !== null).sort((a, b) => Number(b.totalScore) - Number(a.totalScore))[0];
  const issue = analysisDetail.value.featureRows.find((item) => item.compareLabel === 'invalid' || item.compareLabel === 'warning');
  const issueFromSummary = summary.mainIssues.find((item) => typeof item === 'string');
  return {
    validRepsText: `${summary.validReps} / ${summary.totalReps}`,
    validRateText: `${validRate}%`,
    confidenceText: summary.confidenceScore === null ? '-' : `${Math.round(summary.confidenceScore * 100)}%`,
    issueText: issue ? featureLabel(issue.featureCode) : typeof issueFromSummary === 'string' ? issueFromSummary : '未发现明显异常特征',
    topRepText: topRep ? `第 ${topRep.repId ?? '-'} 次动作（${Math.round(Number(topRep.totalScore))} 分）` : '-',
  };
});
const displayScore = computed(() => detail.value?.averageScore ?? analysisDetail.value?.summary?.averageScore ?? '-');
const scoreValue = computed(() => Math.max(0, Math.min(100, Number(displayScore.value) || 0)));
const concernCount = computed(() => analysisDetail.value?.featureRows.filter((item) => item.compareLabel === 'invalid' || item.compareLabel === 'warning').length || 0);
const needsManualReview = computed(() => detail.value?.status === 'failed' || detail.value?.status === 'quality_insufficient' || scoreValue.value < 60 || concernCount.value > 0);
const scoreInterpretation = computed(() => scoreValue.value < 60 ? '建议重点跟进动作质量' : scoreValue.value < 75 ? '存在可改善动作环节' : '本次训练表现稳定');
const primaryAction = computed(() => {
  if (detail.value?.status === 'quality_insufficient') return '通知患者补录';
  if (detail.value?.status === 'failed') return '排查分析失败原因';
  if (detail.value?.status !== 'completed') return '继续观察任务状态';
  return needsManualReview.value ? '人工复核并给予指导' : '归档结果并持续观察';
});
const clinicalDecision = computed(() => {
  if (detail.value?.status === 'quality_insufficient') return { type: 'warning' as const, title: '建议补录', description: detail.value?.failReason || '请提醒患者保证动作完整入镜、光线清晰且拍摄稳定。' };
  if (detail.value?.status === 'failed') return { type: 'danger' as const, title: '分析失败', description: detail.value?.failReason || '请先排查任务失败原因。' };
  if (needsManualReview.value) return { type: 'warning' as const, title: '建议人工复核', description: `优先关注“${analysisSummary.value.issueText}”，结合骨架复核确认异常动作后给予训练提醒。` };
  return { type: 'success' as const, title: '结果可用', description: '本次表现可作为训练记录参考，后续持续关注训练稳定性。' };
});
const dimensionScores = computed(() => {
  const summary = analysisDetail.value?.summary;
  const values = [
    { label: '准确度', value: summary?.accuracyAvg, tone: 'tone-teal' },
    { label: '稳定性', value: summary?.stabilityAvg, tone: 'tone-cyan' },
    { label: '控制度', value: summary?.controlAvg, tone: 'tone-orange' },
    { label: '持续度', value: summary?.durationAvg, tone: 'tone-purple' },
  ];
  return values.map((item) => ({ ...item, value: Math.max(0, Math.min(100, Number(item.value) || 0)), display: item.value === null || item.value === undefined ? '-' : Math.round(Number(item.value)) }));
});
const averageHoldText = computed(() => {
  const value = analysisDetail.value?.summary?.avgHoldDuration;
  return value === null || value === undefined ? '-' : `${Number(value).toFixed(1)} 秒`;
});

function actionTypeLabel(type?: TrainingActionType) { return ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' } as Record<string, string>)[type || ''] || '-'; }
function featureLabel(code: string) { return ({ pelvic_stability: '骨盆稳定性不足', hold_duration: '动作持续度不足', trunk_angle: '躯干角度偏差', knee_rotation_angle: '膝关节旋转幅度偏差' } as Record<string, string>)[code] || `动作特征异常（${code}）`; }
function statusLabel(status?: AnalysisStatus) { return status ? (ANALYSIS_STATUS_LABELS as Record<string, string>)[status] || status : '-'; }
function qualityLabel(status?: string | null) { return !status ? '待评估' : status === 'pass' ? '质量通过' : status === 'insufficient' ? '质量不足' : status; }
function reviewJudgmentLabel(value: string) { return ({ accurate: '准确', partially_accurate: '部分准确', inaccurate: '不准确', unable_to_judge: '无法判断' } as Record<string, string>)[value] || value; }
function reviewDispositionLabel(value: string) { return ({ archive: '确认归档', manual_correction: '采用人工修正', suggest_retake: '建议患者重录', send_guidance: '发送训练建议' } as Record<string, string>)[value] || value; }
async function loadManualReview() { const id = Number(route.params.videoId); if (!id) return; try { manualReview.value = await getManualVideoReview(id); } catch { manualReview.value = null; } }
async function saveReview(payload: SaveManualVideoReviewRequestDto, successMessage: string) { const id = Number(route.params.videoId); if (!id) return; manualReviewSaving.value = true; try { manualReview.value = await saveManualVideoReview(id, payload); ElMessage.success(successMessage); await loadPage(); } catch (error: unknown) { ElMessage.error(`复核保存失败：${error instanceof Error ? error.message : '未知错误'}`); } finally { manualReviewSaving.value = false; } }
function confirmAlgorithmResult() { void saveReview({ accuracyJudgment: 'accurate', disposition: 'archive', useManualResult: false }, '已确认算法结果，原始结果已留存'); }
function openCorrection() { showCorrectionForm.value = true; }
function updateManualScore(value: string) { const digits = value.replace(/\D/g, '').slice(0, 3); reviewForm.value.manualScore = digits ? Number(digits) : null; }
function submitManualReview() { if (reviewForm.value.manualScore === null) { ElMessage.warning('请填写最终评分'); return; } if (reviewForm.value.manualScore > 100) { ElMessage.warning('最终评分需在 0–100 分之间'); return; } void saveReview({ accuracyJudgment: reviewForm.value.accuracyJudgment, disposition: reviewForm.value.disposition, useManualResult: true, manualScore: reviewForm.value.manualScore, manualMainIssues: reviewForm.value.manualIssuesText.split(/[,，]/).map((item) => item.trim()).filter(Boolean), manualAdvice: reviewForm.value.manualAdvice, reviewNote: reviewForm.value.reviewNote }, '人工修正已保存，患者端将采用新结果'); }
async function loadDetail() { const id = Number(route.params.videoId); if (!id) return; loading.value = true; try { detail.value = await getAdminVideoDetail(id); } catch { detail.value = null; ElMessage.error('视频详情加载失败'); } finally { loading.value = false; } }
async function loadAnalysisDetail() { const id = Number(route.params.videoId); if (!id) return; analysisDetailLoading.value = true; try { analysisDetail.value = await getAdminVideoAnalysisDetail(id); } catch { analysisDetail.value = null; } finally { analysisDetailLoading.value = false; } }
async function loadKeypoints() { const id = Number(route.params.videoId); if (!id) return false; keypointsLoading.value = true; try { keypointsData.value = await getAdminVideoKeypoints(id); return true; } catch (error: unknown) { keypointsData.value = null; ElMessage.warning(`关键点数据加载失败：${error instanceof Error ? error.message : '未知错误'}`); return false; } finally { keypointsLoading.value = false; } }
async function toggleReview() {
  if (showReview.value) { await loadKeypoints(); return; }
  showReview.value = true;
  if (!keypointsData.value) await loadKeypoints();
}
async function loadPage() { await Promise.all([loadDetail(), loadAnalysisDetail(), loadManualReview()]); }
onMounted(loadPage);
</script>

<style scoped>
.video-detail-page { gap: 12px; }
.review-section { border: 1px solid rgba(148,180,214,.22); border-radius: 12px; background: rgba(255,255,255,.62); overflow: hidden; }
.review-section__bar { min-height: 66px; padding: 12px 16px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.review-section__title { color: var(--ink-900); font-size: 15px; font-weight: 700; }.review-section__subtitle { margin-top: 4px; color:var(--ink-500); font-size: 12px; }.review-section__actions { display:flex; gap:8px; flex-shrink:0; }
.skeleton-card { border-radius: 0 !important; border-width: 1px 0 0 !important; box-shadow: none !important; }
.compact-hero { padding: 20px 24px; }.compact-hero .page-hero__title { margin: 8px 0 5px; font-size: 24px; }.compact-hero .page-hero__meta { margin-top: 10px; }.hero-glass-card--compact { min-width: 200px; padding: 12px 15px; border-radius: 12px; }.hero-glass-card--compact .hero-glass-card__value { margin-top: 6px; font-size: 18px; }.hero-glass-card--compact .hero-glass-card__hint { margin-top: 6px; }
.compact-toolbar { justify-content: flex-end; margin-top: -6px; }.compact-kpi-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.compact-kpi-card { min-height: 88px; padding: 14px 16px; background: rgba(255,255,255,.92); border: 1px solid rgba(148,180,214,.24); border-radius: 12px; box-shadow: var(--shadow-soft); display: grid; grid-template-columns: 1fr auto; align-items: center; column-gap: 12px; }.compact-kpi-card span { color: var(--ink-500); font-size: 12px; }.compact-kpi-card strong { color: var(--ink-950); font-size: 27px; letter-spacing: -.04em; }.compact-kpi-card strong.is-warning { color: var(--warning); }.compact-kpi-card small { grid-column: 1 / -1; color: var(--ink-500); font-size: 11px; }
.result-card :deep(.el-card__header) { padding: 16px 18px 0 !important; }.result-card :deep(.el-card__body) { padding: 12px 18px 16px !important; }.result-summary-row { display: grid; grid-template-columns: 140px 1fr; gap: 12px; align-items: stretch; }.score-summary { padding: 12px; border-radius: 12px; background: linear-gradient(150deg, rgba(15,154,167,.14), rgba(89,195,239,.06)); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }.score-summary span,.result-facts span { color: var(--ink-500); font-size: 11px; }.score-summary strong { margin: 4px 0; color: var(--brand-700); font-size: 36px; line-height: 1; }.score-summary small { color: var(--ink-700); }.result-facts { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); border: 1px solid rgba(148,180,214,.2); border-radius: 12px; overflow: hidden; }.result-facts div { padding: 9px 12px; border-bottom: 1px solid rgba(148,180,214,.16); }.result-facts div:nth-child(odd) { border-right: 1px solid rgba(148,180,214,.16); }.result-facts strong { display: block; margin-top: 5px; font-size: 13px; color: var(--ink-900); }
.dimension-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(148,180,214,.18); }.dimension-section__head { display:flex; justify-content:space-between; margin-bottom:10px; font-size:12px; }.dimension-section__head span { color: var(--ink-500); }.dimension-row { display:grid; grid-template-columns:46px 1fr 30px; align-items:center; gap:9px; margin:6px 0; font-size:12px; }.dimension-row__bar { height:6px; background: rgba(148,180,214,.21); border-radius:999px; overflow:hidden; }.dimension-row__bar i { display:block; height:100%; border-radius:inherit; }.tone-teal { background:#17a77b; }.tone-cyan { background:#0e9aa7; }.tone-orange { background:#e59a35; }.tone-purple { background:#886bd8; }.dimension-row strong { text-align:right; color:var(--ink-700); }
.recommendation-box { margin-top:10px; padding:8px 10px; background: rgba(15,154,167,.07); border-left:3px solid var(--brand-500); border-radius:6px; color:var(--ink-700); font-size:12px; line-height:1.6; }.recommendation-box__hint { color:var(--ink-500); margin-top:3px; }.skeleton-card { margin-top: 0; }.skeleton-unavailable { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; gap:14px; min-height:128px; padding:18px; background:rgba(247,251,254,.78); }.skeleton-unavailable__icon { display:grid; width:38px; height:38px; place-items:center; border-radius:12px; color:var(--brand-700); background:rgba(79,195,247,.14); font-size:14px; font-weight:800; }.skeleton-unavailable > div:nth-child(2) { display:grid; gap:4px; }.skeleton-unavailable strong { color:var(--ink-900); font-size:13px; }.skeleton-unavailable span { color:var(--ink-500); font-size:12px; line-height:1.6; }
.manual-review-card { border-color: rgba(15,154,167,.22) !important; }.manual-review-card :deep(.el-card__header) { padding: 14px 18px 12px; }.manual-review-card :deep(.el-card__body) { padding: 14px 18px 18px; }.manual-review-simple { display:grid; gap:14px; }.manual-review-simple__intro { display:grid; gap:5px; }.manual-review-simple__intro strong { color:var(--ink-900); font-size:14px; }.manual-review-simple__intro span,.manual-review-form__head span { color:var(--ink-500); font-size:12px; }.manual-review-simple__actions,.manual-review-form__footer { display:flex; gap:10px; align-items:center; }.manual-review-form--correction { padding:14px; border:1px solid rgba(15,154,167,.2); border-radius:10px; background:rgba(15,154,167,.035); }.manual-review-form__head { display:grid; gap:4px; margin-bottom:12px; }.manual-review-form__head strong { color:var(--ink-900); font-size:14px; }.manual-review-correction { display:grid; grid-template-columns:180px 1fr; gap:12px; }.manual-review-form :deep(.el-form-item) { margin-bottom:12px; }.manual-review-form__advanced { display:grid; gap:8px; margin:4px 0 14px; }.review-saved { display:grid; gap:8px; color:var(--ink-700); font-size:13px; }.detail-cards { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px; }.detail-card :deep(.el-card__header) { padding: 14px 16px 10px; border-bottom: 1px solid rgba(148,180,214,.18); }.detail-card :deep(.el-card__body) { padding: 12px 16px 16px; }.collapse-title { color:var(--ink-900); font-weight:700; }.collapse-title small { margin-left:7px; color:var(--ink-500); font-weight:400; }.basic-info-grid,.analysis-detail-grid { display:grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap:8px; }.basic-info-grid div,.analysis-detail-grid div { padding:8px 10px; border-radius:8px; background:rgba(244,248,251,.72); }.basic-info-grid span,.analysis-detail-grid span { display:block; color:var(--ink-500); font-size:11px; margin-bottom:4px; }.basic-info-grid strong,.analysis-detail-grid strong { color:var(--ink-800); font-size:12px; line-height:1.5; }
@media (max-width: 900px) { .compact-kpi-grid,.basic-info-grid,.analysis-detail-grid,.detail-cards,.manual-review-correction { grid-template-columns:1fr; }.result-summary-row { grid-template-columns:1fr; }.result-facts { grid-template-columns:1fr; }.result-facts div:nth-child(odd) { border-right:0; }.compact-toolbar { justify-content:flex-start; }.skeleton-unavailable { grid-template-columns:1fr; } }
</style>
