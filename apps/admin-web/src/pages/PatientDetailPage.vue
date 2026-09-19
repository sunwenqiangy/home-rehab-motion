<template>
  <div class="admin-page patient-detail-page" v-loading="loading">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Patient Profile</div>
          <h1 class="page-hero__title">患者详情</h1>
          <p class="page-hero__subtitle">统一查看患者基础资料、近期训练表现和评分变化；训练记录可直接进入视频详情复核。</p>
          <div class="page-hero__meta"><span class="page-pill">最近 30 天训练趋势</span><span class="page-pill">评分范围 0–100 分</span></div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card"><div class="hero-glass-card__label">最近 30 天完成训练</div><div class="hero-glass-card__value">{{ recentTrendItems.length }}</div><div class="hero-glass-card__hint">仅统计已生成评分的训练记录</div></div>
        </div>
      </div>
    </section>

    <div class="toolbar-group"><el-button @click="router.push('/users')">返回患者列表</el-button><el-button type="primary" :loading="loading" @click="loadDetail">刷新档案</el-button></div>

    <section class="profile-overview">
      <aside class="profile-card">
        <span class="profile-card__avatar" :class="{ 'profile-card__avatar--male': detail?.gender === '男', 'profile-card__avatar--female': detail?.gender === '女' }">{{ detail?.name?.slice(0, 1) || '患' }}</span>
        <div><strong>{{ detail?.name || '-' }}</strong><p>患者 ID #{{ detail?.patientId || '-' }}</p><p>{{ detail?.gender || '未填写' }}<span v-if="detail?.age"> · {{ detail.age }} 岁</span></p></div>
        <div class="profile-card__fields"><div><span>注册时间</span><strong>{{ detail ? formatDate(detail.registeredAt) : '-' }}</strong></div><div><span>联系电话</span><strong>{{ detail?.phone || '未填写' }}</strong></div><div><span>微信标识</span><strong class="profile-card__openid">{{ detail?.openid || '-' }}</strong></div></div>
      </aside>
      <div class="training-panel">
        <div class="training-panel__head"><div><span class="training-panel__eyebrow">TRAINING OVERVIEW</span><h2>训练概览</h2></div><span v-if="detail?.trainingSummary.latestGrade" class="soft-tag" :class="gradeClass(detail.trainingSummary.latestGrade)">最近评级：{{ detail.trainingSummary.latestGrade }}</span></div>
        <div class="training-panel__metrics">
          <div><span>累计训练</span><strong>{{ detail?.trainingSummary.totalTrainingCount ?? 0 }}</strong><small>历史上传记录</small></div>
          <div><span>完成分析</span><strong>{{ detail?.trainingSummary.completedTrainingCount ?? 0 }}</strong><small>已生成训练结果</small></div>
          <div><span>平均得分</span><strong>{{ detail?.trainingSummary.averageScore ?? '-' }}</strong><small>已完成训练均值</small></div>
          <div><span>待处理反馈</span><strong>{{ detail?.trainingSummary.pendingFeedbackCount ?? 0 }}</strong><small>训练相关问题</small></div>
        </div>
        <div class="trend-chart">
          <div class="trend-chart__head">
            <div>
              <strong>最近 30 天评分趋势</strong>
              <small>仅展示完成分析的训练；切换动作可查看单项表现。</small>
            </div>
            <div class="trend-chart__filters">
              <button v-for="option in actionFilters" :key="option.value" type="button" :class="{ active: actionFilter === option.value }" @click="actionFilter = option.value">{{ option.label }}</button>
            </div>
          </div>
          <template v-if="recentTrendItems.length">
            <div class="trend-chart__insights">
              <div><span>最新得分</span><strong>{{ latestTrendPoint ? formatScore(latestTrendPoint.score) : '—' }}<small v-if="latestTrendPoint">分</small></strong></div>
              <div><span>本期变化</span><strong :class="{ 'trend-chart__delta--up': (scoreChange || 0) > 0, 'trend-chart__delta--down': (scoreChange || 0) < 0 }">{{ scoreChange == null ? '—' : formatSignedScore(scoreChange) }}<small v-if="scoreChange != null">分</small></strong></div>
              <div class="trend-chart__summary"><span>趋势判断</span><p>{{ trendSummary }}</p></div>
            </div>
            <div class="trend-chart__body">
              <svg viewBox="0 0 640 200" role="img" aria-label="最近三十天评分趋势，悬浮或聚焦数据点可查看训练明细">
                <defs>
                  <linearGradient id="patient-score-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#32b8ee" stop-opacity=".34" /><stop offset="100%" stop-color="#32b8ee" stop-opacity=".02" /></linearGradient>
                </defs>
                <g v-for="score in trendDomain.ticks" :key="score">
                  <line x1="40" x2="600" :y1="chartYForTick(score)" :y2="chartYForTick(score)" class="trend-chart__grid" />
                  <text x="30" :y="chartYForTick(score) + 4" class="trend-chart__scale">{{ score }}</text>
                </g>
                <polygon :points="chartAreaPoints" class="trend-chart__area" />
                <polyline :points="chartPoints" class="trend-chart__line" fill="none" />
                <g v-for="point in chartPointsData" :key="point.videoId" class="trend-chart__hit" :class="{ active: activeTrendPoint?.videoId === point.videoId }" tabindex="0" @mouseenter="activeTrendPoint = point" @focus="activeTrendPoint = point" @click="activeTrendPoint = point">
                  <circle :cx="point.x" :cy="point.y" r="11" class="trend-chart__halo" />
                  <circle :cx="point.x" :cy="point.y" :r="activeTrendPoint?.videoId === point.videoId ? 6.5 : 5" :class="`trend-chart__point trend-chart__point--${gradeTone(point.grade)}`" />
                  <title>{{ formatDate(point.uploadedAt) }} · {{ actionTypeLabel(point.actionType) }} · {{ formatScore(point.score) }} 分 · {{ point.grade || '未评级' }}</title>
                </g>
              </svg>
              <div class="trend-chart__axis"><span>{{ chartStartLabel }}</span><span>今天</span></div>
            </div>
            <div v-if="trendDisplayPoint" class="trend-chart__detail">
              <span class="trend-chart__detail-date">{{ formatDate(trendDisplayPoint.uploadedAt) }}</span>
              <strong>{{ formatScore(trendDisplayPoint.score) }} 分</strong>
              <span class="soft-tag" :class="gradeClass(trendDisplayPoint.grade || '')">{{ trendDisplayPoint.grade || '未评级' }}</span>
              <span>{{ actionTypeLabel(trendDisplayPoint.actionType) }}</span>
            </div>
          </template>
          <div v-else class="trend-chart__empty">最近 30 天暂无{{ selectedActionLabel }}已完成训练记录</div>
        </div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header><div class="section-header"><div><div class="section-header__title">训练记录</div><div class="section-header__subtitle">点击任意记录进入视频详情，查看动作分析与失败原因。</div></div></div></template>
      <div class="table-shell">
        <el-table :data="detail?.videos || []" stripe empty-text="该患者暂无训练记录">
          <el-table-column prop="videoId" label="视频 ID" width="100" />
          <el-table-column label="动作类型" min-width="150"><template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template></el-table-column>
          <el-table-column label="上传时间" min-width="170"><template #default="{ row }">{{ formatDate(row.uploadedAt) }}</template></el-table-column>
          <el-table-column label="分析状态" width="130"><template #default="{ row }"><span class="soft-tag" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></template></el-table-column>
          <el-table-column label="评分 / 评级" min-width="130"><template #default="{ row }"><span v-if="row.grade" class="soft-tag" :class="gradeClass(row.grade)">{{ row.grade }} {{ row.averageScore ?? '-' }}</span><span v-else>—</span></template></el-table-column>
          <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button type="primary" link @click="router.push(`/videos/${row.videoId}`)">查看视频</el-button></template></el-table-column>
        </el-table>
      </div>
    </el-card>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getAdminPatientDetail, type PatientDetail } from '@/services/patient';
import { ElMessage } from 'element-plus';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';

const route = useRoute();
const router = useRouter();
const detail = ref<PatientDetail | null>(null);
const loading = ref(false);
const actionFilter = ref<'all' | TrainingActionType>('all');
const activeTrendPoint = ref<PatientDetail['scoreTrend'][number] | null>(null);
const actionFilters: Array<{ value: 'all' | TrainingActionType; label: string }> = [
  { value: 'all', label: '全部动作' },
  { value: 'abdominal_crunch', label: '缩腹运动' },
  { value: 'pelvic_tilt', label: '骨盆倾斜' },
  { value: 'knee_rotation', label: '膝关节旋转' },
];
const thirtyDaysAgo = computed(() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 29);
  return date;
});
const recentTrendItems = computed(() => (detail.value?.scoreTrend || []).filter((item) => {
  const uploadedAt = new Date(item.uploadedAt);
  return uploadedAt >= thirtyDaysAgo.value && (actionFilter.value === 'all' || item.actionType === actionFilter.value);
}));
const trendDomain = computed(() => {
  const scores = recentTrendItems.value.map((item) => item.score);
  if (!scores.length) return { min: 0, max: 100, ticks: [0, 50, 100] };
  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const padding = Math.max(4, Math.ceil((rawMax - rawMin || 8) * 0.35));
  const min = Math.max(0, Math.floor((rawMin - padding) / 5) * 5);
  const max = Math.min(100, Math.ceil((rawMax + padding) / 5) * 5);
  const safeMax = max <= min ? Math.min(100, min + 10) : max;
  return { min, max: safeMax, ticks: [min, Math.round((min + safeMax) / 2), safeMax] };
});
const chartPointsData = computed(() => recentTrendItems.value.map((item) => {
  const rangeStart = thirtyDaysAgo.value.getTime();
  const rangeEnd = new Date().getTime();
  const x = rangeEnd === rangeStart ? 40 : 40 + ((new Date(item.uploadedAt).getTime() - rangeStart) / (rangeEnd - rangeStart)) * 560;
  return { ...item, x: Math.max(40, Math.min(600, x)), y: chartY(item.score) };
}));
const chartPoints = computed(() => chartPointsData.value.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
const chartAreaPoints = computed(() => `40,180 ${chartPoints.value} 600,180`);
const chartStartLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(thirtyDaysAgo.value));
const selectedActionLabel = computed(() => actionFilters.find((item) => item.value === actionFilter.value)?.label || '');
const latestTrendPoint = computed(() => chartPointsData.value.at(-1) || null);
const scoreChange = computed(() => {
  const points = chartPointsData.value;
  return points.length > 1 ? points.at(-1)!.score - points[0].score : null;
});
const trendDisplayPoint = computed(() => {
  const activePoint = activeTrendPoint.value;
  return activePoint && chartPointsData.value.some((item) => item.videoId === activePoint.videoId)
    ? activePoint
    : latestTrendPoint.value;
});
const trendSummary = computed(() => {
  if (!latestTrendPoint.value) return '';
  if (scoreChange.value == null) return '已有 1 次完成训练，继续训练可观察评分变化。';
  if (scoreChange.value > 0) return `较本周期首次训练提升 ${formatScore(scoreChange.value)} 分。`;
  if (scoreChange.value < 0) return `较本周期首次训练下降 ${formatScore(Math.abs(scoreChange.value))} 分，建议结合视频复核动作完成情况。`;
  return '本周期评分保持稳定。';
});

function chartY(score: number) {
  const { min, max } = trendDomain.value;
  return 180 - ((Math.max(min, Math.min(max, score)) - min) / Math.max(1, max - min)) * 148;
}

function chartYForTick(score: number) {
  return chartY(score);
}

function gradeTone(grade: string | null) {
  if (grade === '优秀' || grade === '合格') return 'good';
  if (grade === '需改进') return 'warning';
  return 'danger';
}

function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function formatScore(value: number) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value); }
function formatSignedScore(value: number) { return `${value > 0 ? '+' : '-'}${formatScore(Math.abs(value))}`; }
function actionTypeLabel(type: TrainingActionType) { return ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' } as Record<string, string>)[type] || type; }
function statusLabel(status: AnalysisStatus) { return (ANALYSIS_STATUS_LABELS as Record<string, string>)[status] || status; }
function statusClass(status: AnalysisStatus) { return status === 'completed' ? 'soft-tag--success' : status === 'failed' || status === 'quality_insufficient' ? 'soft-tag--danger' : 'soft-tag--warning'; }
function gradeClass(grade: string) { return grade === '优秀' ? 'soft-tag--success' : grade === '合格' ? 'soft-tag--info' : grade === '需改进' ? 'soft-tag--warning' : 'soft-tag--danger'; }

async function loadDetail() {
  const patientId = Number(route.params.patientId);
  if (!patientId) return;
  loading.value = true;
  try { detail.value = await getAdminPatientDetail(patientId); } catch (error: any) { detail.value = null; ElMessage.error(error?.response?.data?.message || '加载患者档案失败'); } finally { loading.value = false; }
}

onMounted(loadDetail);
</script>

<style scoped>
.profile-overview { display: grid; grid-template-columns: minmax(260px, .72fr) minmax(0, 2fr); gap: 18px; }
.profile-card, .training-panel { border: 1px solid rgba(148, 180, 214, .24); border-radius: 22px; background: rgba(255, 255, 255, .9); box-shadow: var(--shadow-soft); }
.profile-card { display: grid; grid-template-columns: 54px 1fr; gap: 14px; align-content: start; padding: 22px; }
.profile-card__avatar { width: 56px; height: 56px; display: inline-flex; align-items: center; justify-content: center; border: 2px solid rgba(255, 255, 255, .72); border-radius: 50%; box-sizing: border-box; background: linear-gradient(145deg, #75cce9, #3e9dd1); box-shadow: 0 8px 18px rgba(43, 151, 197, .2); color: #fff; font-size: 21px; font-weight: 800; line-height: 1; text-shadow: 0 1px 2px rgba(0, 79, 115, .2); }.profile-card__avatar--male { background: linear-gradient(145deg, #75cce9, #3e9dd1); }.profile-card__avatar--female { background: linear-gradient(145deg, #efa0c3, #cb709d); box-shadow: 0 8px 18px rgba(195, 87, 137, .18); }
.profile-card strong { color: var(--ink-950); font-size: 18px; }.profile-card p { margin: 5px 0 0; color: var(--ink-500); font-size: 12px; }
.profile-card__fields { grid-column: 1 / -1; display: grid; gap: 10px; margin-top: 8px; padding-top: 14px; border-top: 1px solid rgba(148, 180, 214, .16); }.profile-card__fields div { display: grid; gap: 4px; }.profile-card__fields span { color: var(--ink-500); font-size: 11px; }.profile-card__fields strong { font-size: 13px; }.profile-card__openid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.training-panel { padding: 22px; }.training-panel__head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }.training-panel__eyebrow { color: var(--brand-700); font-size: 11px; font-weight: 800; letter-spacing: .1em; }.training-panel h2 { margin: 6px 0 0; color: var(--ink-950); font-size: 20px; }.training-panel__metrics { display: grid; grid-template-columns: repeat(4, 1fr); margin: 20px 0; }.training-panel__metrics > div { padding: 0 18px; border-left: 1px solid rgba(148, 180, 214, .16); }.training-panel__metrics > div:first-child { padding-left: 0; border-left: 0; }.training-panel__metrics span, .training-panel__metrics small { display: block; color: var(--ink-500); font-size: 12px; }.training-panel__metrics strong { display: block; margin: 8px 0 5px; color: var(--ink-950); font-size: 28px; }
.trend-chart { padding: 18px; border: 1px solid rgba(143, 186, 216, .18); border-radius: 18px; background: linear-gradient(145deg, #f8fcff 0%, #edf7ff 100%); }.trend-chart__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }.trend-chart__head strong, .trend-chart__head small { display: block; }.trend-chart__head strong { color: var(--ink-900); font-size: 15px; }.trend-chart__head small { margin-top: 5px; color: var(--ink-500); font-size: 11px; }.trend-chart__filters { display: flex; flex-wrap: wrap; gap: 6px; }.trend-chart__filters button { min-height: 30px; padding: 0 10px; border: 1px solid rgba(148, 180, 214, .28); border-radius: 999px; background: rgba(255, 255, 255, .76); color: var(--ink-500); font-size: 11px; cursor: pointer; transition: all .18s ease; }.trend-chart__filters button:hover, .trend-chart__filters button:focus-visible { border-color: var(--brand-500); color: var(--brand-700); outline: none; }.trend-chart__filters button.active { border-color: var(--brand-500); background: rgba(79, 195, 247, .16); color: var(--brand-700); font-weight: 700; box-shadow: 0 3px 8px rgba(79, 195, 247, .14); }.trend-chart__insights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin-top: 16px; padding: 12px 0 0; border-top: 1px solid rgba(148, 180, 214, .18); border-bottom: 1px solid rgba(148, 180, 214, .18); }.trend-chart__insights > div { display: grid; min-width: 0; align-content: center; gap: 3px; padding: 0 16px 12px; border-right: 1px solid rgba(148, 180, 214, .18); }.trend-chart__insights > div:first-child { padding-left: 0; }.trend-chart__insights span { color: var(--ink-500); font-size: 11px; }.trend-chart__insights strong { color: var(--ink-950); font-size: 23px; line-height: 1.1; white-space: nowrap; font-variant-numeric: tabular-nums; }.trend-chart__insights strong small { margin-left: 2px; color: var(--ink-500); font-size: 11px; font-weight: 600; }.trend-chart__delta--up { color: var(--success) !important; }.trend-chart__delta--down { color: var(--danger) !important; }.trend-chart__summary { grid-column: 1 / -1; display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: baseline; gap: 10px; min-width: 0; padding: 10px 0 12px; border-top: 1px solid rgba(148, 180, 214, .18); }.trend-chart__summary span { color: var(--brand-700); font-weight: 700; white-space: nowrap; }.trend-chart__summary p { min-width: 0; margin: 0; color: var(--ink-600); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }.trend-chart__body { margin-top: 14px; }.trend-chart svg { display: block; width: 100%; height: 200px; overflow: visible; }.trend-chart__grid { stroke: rgba(148, 180, 214, .32); stroke-dasharray: 4 6; }.trend-chart__scale { fill: var(--ink-500); font-size: 10px; text-anchor: end; }.trend-chart__area { fill: url(#patient-score-area); }.trend-chart__line { stroke: var(--brand-500); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; filter: drop-shadow(0 3px 4px rgba(59, 159, 217, .18)); }.trend-chart__hit { cursor: pointer; outline: none; }.trend-chart__hit:focus-visible .trend-chart__halo, .trend-chart__hit:hover .trend-chart__halo, .trend-chart__hit.active .trend-chart__halo { fill: rgba(79, 195, 247, .16); }.trend-chart__halo { fill: transparent; transition: fill .16s ease; }.trend-chart__point { stroke: #fff; stroke-width: 2.5; transition: r .16s ease; }.trend-chart__point--good { fill: var(--success); }.trend-chart__point--warning { fill: var(--warning); }.trend-chart__point--danger { fill: var(--danger); }.trend-chart__axis { display: flex; justify-content: space-between; padding: 0 4px 0 40px; color: var(--ink-500); font-size: 11px; }.trend-chart__detail { display: flex; align-items: center; gap: 8px; min-height: 36px; margin-top: 10px; padding: 0 12px; border-radius: 10px; background: rgba(255, 255, 255, .72); color: var(--ink-600); font-size: 12px; }.trend-chart__detail-date { color: var(--ink-500); }.trend-chart__detail strong { color: var(--ink-950); font-size: 14px; }.trend-chart__empty { margin-top: 12px; padding: 30px 0; text-align: center; color: var(--ink-500); font-size: 12px; }
@media (max-width: 900px) { .profile-overview { grid-template-columns: 1fr; }.training-panel__metrics { grid-template-columns: repeat(2, 1fr); gap: 18px; }.training-panel__metrics > div:nth-child(3) { padding-left: 0; border-left: 0; } }
@media (max-width: 720px) { .training-panel__metrics { grid-template-columns: 1fr; }.training-panel__metrics > div { padding-left: 0; border-left: 0; }.trend-chart__insights > div:nth-child(2) { border-right: 0; }.trend-chart__summary { grid-template-columns: 1fr; gap: 3px; }.trend-chart__detail { flex-wrap: wrap; padding: 8px 12px; } }
</style>
