<template>
  <div class="admin-page dashboard-page" v-loading="loading">
    <section class="page-hero dashboard-banner">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Rehabilitation Operations</div>
          <h1 class="page-hero__title">训练运营工作台</h1>
          <p class="page-hero__subtitle">聚合训练分析、患者反馈与内容配置状态，优先处理异常任务并跟进训练质量。</p>
          <div class="dashboard-banner__actions">
            <el-button type="primary" @click="router.push('/videos')">查看训练视频</el-button>
            <el-button plain @click="router.push('/feedback')">处理反馈工单</el-button>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card dashboard-health">
            <span>当前分析完成率</span>
            <strong>{{ completionRate }}%</strong>
            <div class="dashboard-health__track"><i :style="{ width: `${completionRate}%` }"></i></div>
            <small>{{ stats.completedAnalysis }} 已完成 · {{ pendingAnalysisCount }} 待处理</small>
          </div>
        </div>
      </div>
    </section>

    <section class="metric-grid dashboard-metrics">
      <button v-for="item in metricCards" :key="item.label" type="button" class="metric-card metric-card--action" @click="item.onClick()">
        <div class="metric-card__label">{{ item.label }}</div>
        <div class="metric-card__value">{{ item.value }}</div>
        <div class="metric-card__foot"><span :class="item.tone">{{ item.hint }}</span><span class="metric-card__icon"><el-icon><component :is="item.icon" /></el-icon></span></div>
      </button>
    </section>

    <section class="dashboard-panels dashboard-panels--two">
      <section class="trend-panel surface-card">
      <div class="section-header"><div><div class="section-header__title">运营趋势</div><div class="section-header__subtitle">视频上传、完成分析与新增患者按天统计，帮助观察业务活跃度与分析产能。</div></div><div class="period-switch"><button v-for="item in periodOptions" :key="item.value" type="button" :class="{ active: trendDays === item.value }" @click="changeTrendDays(item.value)">{{ item.label }}</button></div></div>
      <div class="trend-chart"><div class="trend-chart__toolbar"><div class="trend-chart__legend"><button v-for="series in trendSeries" :key="series.key" type="button" :class="{ active: visibleTrendSeries.includes(series.key) }" @click="toggleTrendSeries(series.key)"><i :class="`trend-chart__legend--${series.key}`"></i>{{ series.label }}</button></div><small>悬浮数据点查看明细</small></div><div v-if="overview.trend.length" class="trend-line-chart" @mouseleave="hideTrendTooltip"><svg viewBox="0 0 800 350" role="img" aria-label="运营趋势折线图"><defs><linearGradient id="trend-upload-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3c9fd9" stop-opacity=".25"/><stop offset="100%" stop-color="#3c9fd9" stop-opacity="0"/></linearGradient><linearGradient id="trend-completed-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#2cb67d" stop-opacity=".2"/><stop offset="100%" stop-color="#2cb67d" stop-opacity="0"/></linearGradient><linearGradient id="trend-patient-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#ed9b36" stop-opacity=".18"/><stop offset="100%" stop-color="#ed9b36" stop-opacity="0"/></linearGradient></defs><line v-for="value in [0, 0.25, 0.5, 0.75, 1]" :key="value" class="trend-line-chart__grid" x1="52" x2="776" :y1="trendYByRatio(value)" :y2="trendYByRatio(value)"/><text v-for="value in [0, 0.5, 1]" :key="`axis-${value}`" class="trend-line-chart__scale" x="8" :y="trendYByRatio(value) + 4">{{ Math.round(maxTrendValue * (1 - value)) }}</text><polygon v-for="series in trendSeries" v-show="visibleTrendSeries.includes(series.key)" :key="`area-${series.key}`" class="trend-line-chart__area" :class="`trend-line-chart__area--${series.key}`" :points="trendAreaPoints(series.key)"/><polyline v-for="series in trendSeries" v-show="visibleTrendSeries.includes(series.key)" :key="series.key" class="trend-line-chart__line" :class="`trend-line-chart__line--${series.key}`" :points="trendPoints(series.key)"/><g v-for="item in overview.trend" :key="item.date" class="trend-line-chart__day" :class="{ active: activeTrendDate === item.date, selected: selectedTrendDate === item.date }" @mouseenter="showTrendTooltip(item, $event)" @mousemove="moveTrendTooltip($event)" @click="selectTrendDate(item.date)"><rect :x="trendX(item) - trendHitWidth / 2" y="26" :width="trendHitWidth" height="264"/><line class="trend-line-chart__cursor" :x1="trendX(item)" :x2="trendX(item)" y1="26" y2="290"/><circle v-for="series in trendSeries" v-show="visibleTrendSeries.includes(series.key)" :key="series.key" class="trend-line-chart__point" :class="`trend-line-chart__point--${series.key}`" :cx="trendX(item)" :cy="trendY(item[series.key])" r="4"/><text v-if="shouldShowTrendLabel(item)" class="trend-line-chart__label" :x="trendX(item)" y="324">{{ formatTrendDate(item.date) }}</text></g></svg><div v-if="trendTooltip" class="trend-tooltip" :class="{ 'trend-tooltip--left': trendTooltip.alignLeft }" :style="{ left: `${trendTooltip.x}px`, top: `${trendTooltip.y}px` }"><strong>{{ trendTooltip.date }}</strong><span><i class="trend-detail__dot trend-detail__dot--uploads"></i>视频上传 <b>{{ trendTooltip.uploads }}</b></span><span><i class="trend-detail__dot trend-detail__dot--completed"></i>完成分析 <b>{{ trendTooltip.completed }}</b></span><span><i class="trend-detail__dot trend-detail__dot--newPatients"></i>新增患者 <b>{{ trendTooltip.newPatients }}</b></span></div></div><div v-else class="trend-chart__empty">当前周期暂无趋势数据</div></div>
      </section>

      <section class="dashboard-status">
        <el-card class="surface-card" shadow="never">
        <template #header><div class="section-header"><div><div class="section-header__title">当前训练任务状态</div><div class="section-header__subtitle">基于当前分析队列汇总；点击任务监控查看具体原因与重试状态。</div></div><el-button type="primary" link @click="router.push('/analysis-tasks')">查看任务监控</el-button></div></template>
        <div class="status-chart" aria-label="训练分析状态分布">
          <button v-for="item in statusSummary" :key="item.key" class="status-chart__item" type="button" @click="goToTaskStatus(item.status)">
            <div class="status-chart__bar-wrap"><div class="status-chart__bar" :class="`status-chart__bar--${item.tone}`" :style="{ height: `${barHeight(item.count)}%` }"><span v-if="item.count">{{ item.count }}</span></div></div>
            <strong>{{ item.label }}</strong><small>{{ item.count }} 条</small>
          </button>
        </div>
        </el-card>
      </section>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header><div class="section-header"><div><div class="section-header__title">需要关注的训练</div><div class="section-header__subtitle">优先展示分析失败、质量不足和仍在处理的训练记录。</div></div><el-button type="primary" plain @click="router.push('/videos')">查看全部</el-button></div></template>
      <div class="table-shell"><el-table :data="recentVideos" stripe empty-text="当前没有需要关注的训练记录"><el-table-column prop="videoId" label="视频 ID" width="95"/><el-table-column label="动作类型" min-width="150"><template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template></el-table-column><el-table-column label="患者" min-width="130"><template #default="{ row }">{{ row.patientName || '未命名患者' }}</template></el-table-column><el-table-column label="分析状态" width="130"><template #default="{ row }"><span class="soft-tag" :class="tagClass(row.status)">{{ statusLabel(row.status) }}</span></template></el-table-column><el-table-column prop="uploadedAt" label="上传时间" min-width="180"/><el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button type="primary" link @click="router.push(`/videos/${row.videoId}`)">查看详情</el-button></template></el-table-column></el-table></div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChatDotRound, TrendCharts, WarningFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getAdminAnalysisTasks, getAdminDashboardOverview, getAdminVideoList, type AdminDashboardOverview } from '@/services/video';
import { getFeedbackList } from '@/services/feedback';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';

const router = useRouter();
const loading = ref(false);
const stats = reactive({ videoCount: 0, pendingFeedback: 0, completedAnalysis: 0 });
const recentVideos = ref<any[]>([]);
const videos = ref<any[]>([]);
const taskItems = ref<any[]>([]);
const trendDays = ref<7 | 30>(7);
const overview = ref<AdminDashboardOverview>({ days: 7, totalPatients: 0, activePatientCount: 0, newPatientCount: 0, videoUploadCount: 0, completedAnalysisCount: 0, allVideoCount: 0, allCompletedAnalysisCount: 0, analysisStatusCounts: {}, trend: [] });
const periodOptions: Array<{ value: 7 | 30; label: string }> = [{ value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }];
const trendSeries = [{ key: 'uploads', label: '视频上传' }, { key: 'completed', label: '完成分析' }, { key: 'newPatients', label: '新增患者' }] as const;
type TrendSeriesKey = typeof trendSeries[number]['key'];
const visibleTrendSeries = ref<TrendSeriesKey[]>(['uploads', 'completed', 'newPatients']);
const hoveredTrendDate = ref('');
const selectedTrendDate = ref('');
const trendTooltip = ref<{ date: string; uploads: number; completed: number; newPatients: number; x: number; y: number; alignLeft: boolean } | null>(null);
const completionRate = computed(() => overview.value.allVideoCount ? Math.round((overview.value.allCompletedAnalysisCount / overview.value.allVideoCount) * 100) : 0);
const completedAnalysisCount = computed(() => overview.value.analysisStatusCounts.completed || 0);
const pendingAnalysisCount = computed(() => ['pending', 'uploading', 'queued', 'processing', 'review_required'].reduce((total, status) => total + (overview.value.analysisStatusCounts[status] || 0), 0));
const failedAnalysisCount = computed(() => overview.value.analysisStatusCounts.failed || 0);
const qualityInsufficientCount = computed(() => overview.value.analysisStatusCounts.quality_insufficient || 0);
const metricCards = computed(() => [
  { label: '累计患者', value: overview.value.totalPatients, hint: `${overview.value.activePatientCount} 位近期活跃`, tone: 'metric-card__trend--up', icon: TrendCharts, onClick: () => router.push('/users') },
  { label: `近 ${trendDays.value} 天新增患者`, value: overview.value.newPatientCount, hint: '当前趋势统计周期内新建档案', tone: 'metric-card__trend--up', icon: TrendCharts, onClick: () => router.push('/users') },
  { label: `近 ${trendDays.value} 天视频上传`, value: overview.value.videoUploadCount, hint: `${overview.value.completedAnalysisCount} 条已完成分析`, tone: 'metric-card__trend--up', icon: WarningFilled, onClick: () => router.push('/videos') },
  { label: '待处理反馈', value: stats.pendingFeedback, hint: stats.pendingFeedback ? '需要优先回复患者' : '当前无待处理反馈', tone: stats.pendingFeedback ? 'metric-card__trend--warn' : 'metric-card__trend--up', icon: ChatDotRound, onClick: () => router.push('/feedback') },
]);
const statusSummary = computed(() => [
  { key: 'completed', label: '已完成', count: completedAnalysisCount.value, tone: 'success', status: 'completed' },
  { key: 'processing', label: '分析中', count: pendingAnalysisCount.value, tone: 'primary', status: 'processing' },
  { key: 'quality', label: '质量不足', count: qualityInsufficientCount.value, tone: 'warning', status: 'quality_insufficient' },
  { key: 'failed', label: '失败', count: failedAnalysisCount.value, tone: 'danger', status: 'failed' },
]);
function barHeight(value: number) { const max = Math.max(...statusSummary.value.map((item) => item.count), 1); return Math.max(value ? 12 : 0, Math.round((value / max) * 100)); }
const maxTrendValue = computed(() => Math.max(...overview.value.trend.flatMap((item) => [item.uploads, item.completed, item.newPatients]), 1));
const activeTrendDate = computed(() => hoveredTrendDate.value || selectedTrendDate.value);
const activeTrendItem = computed(() => overview.value.trend.find((item) => item.date === activeTrendDate.value));
const trendChartLeft = 52;
const trendChartRight = 776;
const trendChartTop = 26;
const trendChartBottom = 290;
const trendHitWidth = computed(() => Math.max((trendChartRight - trendChartLeft) / Math.max(overview.value.trend.length, 1), 18));
function trendX(item: AdminDashboardOverview['trend'][number]) { const index = overview.value.trend.indexOf(item); const total = Math.max(overview.value.trend.length - 1, 1); return trendChartLeft + ((trendChartRight - trendChartLeft) * index) / total; }
function trendY(value: number) { return trendChartBottom - (value / maxTrendValue.value) * (trendChartBottom - trendChartTop); }
function trendYByRatio(ratio: number) { return trendChartBottom - ratio * (trendChartBottom - trendChartTop); }
function trendPoints(key: TrendSeriesKey) { return overview.value.trend.map((item) => `${trendX(item)},${trendY(item[key])}`).join(' '); }
function trendAreaPoints(key: TrendSeriesKey) { const points = trendPoints(key); return points ? `${trendChartLeft},${trendChartBottom} ${points} ${trendChartRight},${trendChartBottom}` : ''; }
function shouldShowTrendLabel(item: AdminDashboardOverview['trend'][number]) { const index = overview.value.trend.indexOf(item); const total = overview.value.trend.length; return total <= 7 || index === 0 || index === total - 1 || index % Math.ceil(total / 6) === 0; }
function selectTrendDate(date: string) { selectedTrendDate.value = selectedTrendDate.value === date ? '' : date; }
function getTrendTooltipPosition(event: MouseEvent) { const chart = (event.currentTarget as SVGGElement).ownerSVGElement?.getBoundingClientRect(); const x = chart ? event.clientX - chart.left : event.offsetX; const y = chart ? event.clientY - chart.top : event.offsetY; return { x, y: Math.max(y - 12, 112), alignLeft: chart ? x > chart.width - 155 : false }; }
function showTrendTooltip(item: AdminDashboardOverview['trend'][number], event: MouseEvent) { hoveredTrendDate.value = item.date; trendTooltip.value = { ...item, ...getTrendTooltipPosition(event) }; }
function moveTrendTooltip(event: MouseEvent) { if (trendTooltip.value) trendTooltip.value = { ...trendTooltip.value, ...getTrendTooltipPosition(event) }; }
function hideTrendTooltip() { hoveredTrendDate.value = ''; trendTooltip.value = null; }
function formatTrendDate(value: string) { return value.slice(5).replace('-', '/'); }
function toggleTrendSeries(key: TrendSeriesKey) { visibleTrendSeries.value = visibleTrendSeries.value.includes(key) ? visibleTrendSeries.value.filter((item) => item !== key) : [...visibleTrendSeries.value, key]; }
function actionTypeLabel(type: TrainingActionType) { return ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' } as Record<string, string>)[type] || type; }
function statusLabel(status: AnalysisStatus) { return (ANALYSIS_STATUS_LABELS as Record<string, string>)[status] || status; }
function tagClass(status: AnalysisStatus) { return status === 'completed' ? 'soft-tag--success' : status === 'failed' || status === 'quality_insufficient' ? 'soft-tag--danger' : 'soft-tag--warning'; }
function goToTaskStatus(status: string) { router.push({ path: '/analysis-tasks', query: { status } }); }
async function changeTrendDays(days: 7 | 30) { if (trendDays.value === days) return; trendDays.value = days; await loadDashboard(); }
async function loadDashboard() {
  loading.value = true;
  try {
    const results = await Promise.allSettled([getAdminVideoList({ page: 1, limit: 100 }), getAdminAnalysisTasks({ page: 1, limit: 100 }), getFeedbackList(false, { page: 1, limit: 100 }), getAdminDashboardOverview(trendDays.value)]);
    const [videoResult, taskResult, feedbackResult, overviewResult] = results;
    if (videoResult.status === 'fulfilled') {
      videos.value = videoResult.value.items;
      stats.videoCount = videoResult.value.total;
      stats.completedAnalysis = videos.value.filter((item) => item.status === 'completed').length;
      const riskRank: Record<string, number> = { failed: 0, quality_insufficient: 1, review_required: 2, processing: 3, queued: 3, pending: 3, uploading: 3, completed: 9 };
      recentVideos.value = [...videos.value].sort((left, right) => (riskRank[left.status] ?? 8) - (riskRank[right.status] ?? 8)).filter((item) => item.status !== 'completed').slice(0, 5);
    }
    if (taskResult.status === 'fulfilled') taskItems.value = taskResult.value.items;
    if (feedbackResult.status === 'fulfilled') stats.pendingFeedback = feedbackResult.value.items.filter((item) => item.status === 'pending').length;
    if (overviewResult.status === 'fulfilled') {
      overview.value = overviewResult.value;
      stats.videoCount = overview.value.allVideoCount;
      stats.completedAnalysis = overview.value.allCompletedAnalysisCount;
    }
    if (results.some((result) => result.status === 'rejected')) ElMessage.warning('部分工作台数据加载失败，请刷新后重试');
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '工作台数据加载失败');
  } finally {
    loading.value = false;
  }
}
onMounted(loadDashboard);
</script>

<style scoped>
.dashboard-banner{padding:28px 30px;border-radius:var(--radius-xl);color:#fff}.trend-panel{margin:0;padding:22px 24px;border:1px solid rgba(148,180,214,.24);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(248,251,255,.9));box-shadow:var(--shadow-soft)}.period-switch{display:flex;gap:6px;padding:4px;border-radius:10px;background:rgba(232,242,250,.72)}.period-switch button{padding:6px 11px;border:0;border-radius:7px;background:transparent;color:var(--ink-500);font-size:12px;cursor:pointer}.period-switch button.active{background:#fff;color:var(--brand-700);font-weight:700;box-shadow:0 2px 6px rgba(29,75,113,.1)}.trend-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.trend-summary__item{position:relative;min-width:0;padding:15px 17px 15px 19px;overflow:hidden;border:1px solid rgba(148,180,214,.14);border-radius:12px;background:#f8fbfd}.trend-summary__item:before{position:absolute;top:0;bottom:0;left:0;width:4px;content:''}.trend-summary__item--uploads:before{background:#3c9fd9}.trend-summary__item--completed:before{background:#2cb67d}.trend-summary__item--patients:before{background:#ed9b36}.trend-summary span,.trend-summary small{display:block;overflow:hidden;color:var(--ink-500);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.trend-summary strong{display:block;margin:5px 0;color:var(--ink-950);font-size:25px}.trend-chart{padding:16px;border:1px solid rgba(148,180,214,.15);border-radius:14px;background:#fff}.trend-chart__toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.trend-chart__toolbar>small{color:var(--ink-500);font-size:11px}.trend-chart__legend{display:flex;gap:8px}.trend-chart__legend button{display:flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--ink-500);font-size:12px;cursor:pointer}.trend-chart__legend button.active{border-color:rgba(60,159,217,.22);background:#fff;color:var(--ink-800);font-weight:700}.trend-chart__legend i{width:8px;height:8px;border-radius:999px}.trend-chart__legend--uploads{background:#3c9fd9}.trend-chart__legend--completed{background:#2cb67d}.trend-chart__legend--newPatients{background:#ed9b36}.trend-line-chart{height:350px;margin-top:12px;border:1px solid rgba(148,180,214,.14);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.76),rgba(239,247,252,.42));overflow:hidden}.trend-line-chart svg{display:block;width:100%;height:100%;overflow:visible}.trend-line-chart__grid{stroke:rgba(148,180,214,.3);stroke-dasharray:4 5}.trend-line-chart__scale,.trend-line-chart__label{fill:var(--ink-500);font-size:10px}.trend-line-chart__label{text-anchor:middle}.trend-line-chart__area--uploads{fill:url(#trend-upload-area)}.trend-line-chart__area--completed{fill:url(#trend-completed-area)}.trend-line-chart__area--newPatients{fill:url(#trend-patient-area)}.trend-line-chart__line{fill:none;stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 2px rgba(25,72,109,.1))}.trend-line-chart__line--uploads{stroke:#3c9fd9}.trend-line-chart__line--completed{stroke:#2cb67d}.trend-line-chart__line--newPatients{stroke:#ed9b36}.trend-line-chart__day{cursor:pointer}.trend-line-chart__day rect{fill:transparent}.trend-line-chart__cursor{display:none;stroke:rgba(60,159,217,.42);stroke-dasharray:3 4}.trend-line-chart__day.active rect,.trend-line-chart__day:hover rect{fill:rgba(60,159,217,.07)}.trend-line-chart__day.active .trend-line-chart__cursor,.trend-line-chart__day:hover .trend-line-chart__cursor{display:block}.trend-line-chart__point{stroke:#fff;stroke-width:2.5;transition:r .2s,filter .2s}.trend-line-chart__point--uploads{fill:#3c9fd9}.trend-line-chart__point--completed{fill:#2cb67d}.trend-line-chart__point--newPatients{fill:#ed9b36}.trend-line-chart__day.active .trend-line-chart__point,.trend-line-chart__day:hover .trend-line-chart__point{r:6;filter:drop-shadow(0 2px 3px rgba(25,72,109,.25))}.trend-detail{display:flex;flex-direction:column;justify-content:center;min-width:0;padding:18px 16px;border:1px solid rgba(148,180,214,.16);border-radius:14px;background:linear-gradient(160deg,#fff,rgba(241,248,252,.82));color:var(--ink-600);box-shadow:0 6px 18px rgba(29,75,113,.05)}.trend-detail__date{padding-bottom:14px;border-bottom:1px solid rgba(148,180,214,.18)}.trend-detail small,.trend-detail strong{display:block}.trend-detail small{font-size:11px;color:var(--ink-500)}.trend-detail strong{margin-top:3px;color:var(--ink-900);font-size:18px}.trend-detail em{font-style:normal;color:var(--ink-500);font-size:10px}.trend-detail__metrics{display:grid;gap:13px;padding-top:15px}.trend-detail__metrics span{display:grid;grid-template-columns:8px 1fr auto auto;align-items:center;gap:6px}.trend-detail__metrics b{color:var(--ink-900);font-size:18px;line-height:1}.trend-detail__dot{width:8px;height:8px;border-radius:99px}.trend-detail__dot--uploads{background:#3c9fd9}.trend-detail__dot--completed{background:#2cb67d}.trend-detail__dot--newPatients{background:#ed9b36}.trend-detail__placeholder{color:var(--ink-500);font-size:12px;line-height:1.8;text-align:center}.trend-chart__empty{padding:56px 0;text-align:center;color:var(--ink-500);font-size:12px}@media(max-width:980px){.trend-summary{grid-template-columns:repeat(3,1fr)}.trend-content{grid-template-columns:1fr}.trend-detail{display:grid;grid-template-columns:180px 1fr;gap:18px}.trend-detail__date{padding:0 18px 0 0;border-right:1px solid rgba(148,180,214,.18);border-bottom:0}.trend-detail__metrics{grid-template-columns:repeat(3,1fr);gap:10px;padding:0}.trend-detail__metrics span{grid-template-columns:8px 1fr auto auto}}@media(max-width:600px){.trend-panel{padding:16px}.trend-summary{grid-template-columns:repeat(2,1fr)}.period-switch{margin-top:8px}.trend-chart__toolbar{align-items:flex-start;flex-direction:column}.trend-chart__legend{gap:5px;flex-wrap:wrap;font-size:11px}.trend-line-chart{height:280px}.trend-detail{display:flex;gap:12px}.trend-detail__date{padding:0 0 12px;border-right:0;border-bottom:1px solid rgba(148,180,214,.18)}.trend-detail__metrics{grid-template-columns:1fr;padding-top:12px}}.dashboard-banner__content{display:flex;align-items:center;justify-content:space-between;gap:32px}.dashboard-banner__eyebrow{font-size:11px;letter-spacing:.13em;color:#91ddff;font-weight:800}.dashboard-banner h1{margin:7px 0;font-size:25px}.dashboard-banner p{max-width:680px;margin:0;color:rgba(239,249,255,.76);font-size:13px;line-height:1.7}.dashboard-banner__actions{display:flex;gap:10px;margin-top:18px}.dashboard-health{min-width:200px;padding:17px 19px;border:1px solid rgba(255,255,255,.18);border-radius:14px;background:rgba(5,29,52,.2)}.dashboard-health span,.dashboard-health small{display:block;color:rgba(232,247,255,.74);font-size:12px}.dashboard-health strong{display:block;margin:5px 0 9px;font-size:30px}.dashboard-health__track{height:6px;overflow:hidden;border-radius:99px;background:rgba(255,255,255,.18)}.dashboard-health__track i{display:block;height:100%;border-radius:inherit;background:#72dcff}.dashboard-health small{margin-top:10px}.dashboard-metrics{margin-top:16px}.dashboard-panels{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(340px,.8fr);gap:16px;margin:16px 0}.status-chart{height:230px;display:flex;align-items:end;justify-content:space-around;gap:18px;padding:12px 22px 0;border-radius:14px;background:linear-gradient(180deg,rgba(238,247,252,.7),rgba(250,252,255,.9))}.status-chart__item{height:100%;min-width:56px;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:6px;border:0;background:transparent;color:var(--ink-600);font-size:12px;cursor:pointer}.status-chart__item:hover .status-chart__bar{filter:brightness(.9);transform:translateY(-3px)}.status-chart__item:hover strong{color:var(--brand-700)}.status-chart__item strong{color:var(--ink-800);font-size:12px}.status-chart__item small{font-size:11px}.status-chart__bar-wrap{height:166px;width:28px;display:flex;align-items:end}.status-chart__bar{width:100%;min-height:0;display:flex;justify-content:center;align-items:flex-start;padding-top:7px;border-radius:7px 7px 2px 2px;color:#fff;font-weight:800;font-size:11px;transition:height .3s}.status-chart__bar--success{background:#2cb67d}.status-chart__bar--primary{background:#3c9fd9}.status-chart__bar--warning{background:#ed9b36}.status-chart__bar--danger{background:#ef6470}.priority-list{display:grid;gap:10px}.priority-item{display:grid;grid-template-columns:38px 1fr auto;align-items:center;gap:11px;width:100%;padding:12px;border:1px solid rgba(148,180,214,.2);border-radius:12px;background:#fff;text-align:left;cursor:pointer}.priority-item:hover{border-color:rgba(57,169,222,.5);box-shadow:0 8px 18px rgba(25,72,109,.08)}.priority-item__index{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;font-weight:800;font-size:12px}.priority-item__index--danger{background:rgba(239,100,112,.12);color:#cc4854}.priority-item__index--warning{background:rgba(237,155,54,.14);color:#b66c08}.priority-item__index--info{background:rgba(60,159,217,.12);color:#176c9d}.priority-item strong,.priority-item small{display:block}.priority-item strong{color:var(--ink-900);font-size:13px}.priority-item small{margin-top:4px;color:var(--ink-500);font-size:11px;line-height:1.45}.priority-item b{color:var(--brand-700);font-size:12px;white-space:nowrap}@media(max-width:980px){.dashboard-banner__content{align-items:flex-start;flex-direction:column}.dashboard-health{width:100%;box-sizing:border-box}.dashboard-panels{grid-template-columns:1fr}}@media(max-width:600px){.dashboard-banner{padding:22px}.dashboard-banner__actions{flex-wrap:wrap}.status-chart{padding-left:8px;padding-right:8px;gap:8px}.priority-item{grid-template-columns:36px 1fr}.priority-item b{display:none}}
.metric-card--action{border:0;cursor:pointer;text-align:left}.metric-card--action:hover{transform:translateY(-2px);box-shadow:0 10px 22px rgba(29,75,113,.12)}.trend-line-chart{position:relative;height:360px;margin-top:14px;border:0;background:linear-gradient(180deg,#fcfeff,#f6fafc)}.trend-tooltip{position:absolute;z-index:3;display:grid;gap:7px;min-width:132px;padding:11px 13px;pointer-events:none;border:1px solid rgba(148,180,214,.2);border-radius:9px;background:rgba(255,255,255,.96);box-shadow:0 9px 24px rgba(29,75,113,.16);color:var(--ink-600);font-size:12px;transform:translate(16px,-100%)}.trend-tooltip--left{transform:translate(calc(-100% - 16px),-100%)}.trend-tooltip strong{padding-bottom:5px;border-bottom:1px solid rgba(148,180,214,.16);color:var(--ink-900)}.trend-tooltip span{display:flex;align-items:center;justify-content:space-between;gap:12px}.trend-tooltip span i{margin-right:2px}.trend-tooltip b{color:var(--ink-900)}.dashboard-panels--two{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:stretch;margin:0}.dashboard-panels--two>.trend-panel,.dashboard-panels--two>.dashboard-status,.dashboard-panels--two>.dashboard-status>.surface-card{box-sizing:border-box;height:100%}.dashboard-panels--two>.dashboard-status>.surface-card{display:flex;flex-direction:column}.dashboard-panels--two>.dashboard-status :deep(.el-card__body){flex:1;display:flex;align-items:center}.dashboard-panels--two .status-chart{width:100%;height:360px}@media(max-width:600px){.trend-summary{grid-template-columns:1fr}.trend-line-chart{height:280px}.dashboard-panels--two{grid-template-columns:1fr}.dashboard-panels--two .status-chart{height:230px}}
</style>
