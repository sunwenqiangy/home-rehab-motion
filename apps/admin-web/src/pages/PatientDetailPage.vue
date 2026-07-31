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
        <span class="profile-card__avatar">{{ detail?.name?.slice(0, 1) || '患' }}</span>
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
        <div class="trend-chart"><div class="trend-chart__head"><div><strong>最近 30 天评分趋势</strong><small>仅展示完成分析的训练；切换动作可查看单项表现。</small></div><div class="trend-chart__filters"><button v-for="option in actionFilters" :key="option.value" type="button" :class="{ active: actionFilter === option.value }" @click="actionFilter = option.value">{{ option.label }}</button></div></div><div v-if="recentTrendItems.length" class="trend-chart__body"><svg viewBox="0 0 600 154" preserveAspectRatio="none" role="img" aria-label="最近三十天评分趋势"><line v-for="score in [0, 25, 50, 75, 100]" :key="score" x1="0" x2="600" :y1="chartY(score)" :y2="chartY(score)" class="trend-chart__grid" /><polyline :points="chartPoints" class="trend-chart__line" fill="none" /><circle v-for="point in chartPointsData" :key="point.videoId" :cx="point.x" :cy="point.y" r="5" :class="`trend-chart__point trend-chart__point--${gradeTone(point.grade)}`"><title>{{ formatDate(point.uploadedAt) }} · {{ point.score }} 分 · {{ point.grade || '未评级' }}</title></circle></svg><div class="trend-chart__axis"><span>{{ chartStartLabel }}</span><span>今天</span></div></div><div v-else class="trend-chart__empty">最近 30 天暂无{{ selectedActionLabel }}已完成训练记录</div></div>
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
const chartPointsData = computed(() => recentTrendItems.value.map((item) => {
  const rangeStart = thirtyDaysAgo.value.getTime();
  const rangeEnd = new Date().getTime();
  const x = rangeEnd === rangeStart ? 0 : ((new Date(item.uploadedAt).getTime() - rangeStart) / (rangeEnd - rangeStart)) * 600;
  return { ...item, x: Math.max(0, Math.min(600, x)), y: chartY(item.score) };
}));
const chartPoints = computed(() => chartPointsData.value.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '));
const chartStartLabel = computed(() => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(thirtyDaysAgo.value));
const selectedActionLabel = computed(() => actionFilters.find((item) => item.value === actionFilter.value)?.label || '');

function chartY(score: number) {
  return 146 - Math.max(0, Math.min(100, score)) * 1.38;
}

function gradeTone(grade: string | null) {
  if (grade === '优秀' || grade === '合格') return 'good';
  if (grade === '需改进') return 'warning';
  return 'danger';
}

function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
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
.profile-card__avatar { width: 54px; height: 54px; display: inline-flex; align-items: center; justify-content: center; border-radius: 18px; background: linear-gradient(135deg, var(--brand-500), #87dcff); color: #fff; font-size: 20px; font-weight: 800; }
.profile-card strong { color: var(--ink-950); font-size: 18px; }.profile-card p { margin: 5px 0 0; color: var(--ink-500); font-size: 12px; }
.profile-card__fields { grid-column: 1 / -1; display: grid; gap: 10px; margin-top: 8px; padding-top: 14px; border-top: 1px solid rgba(148, 180, 214, .16); }.profile-card__fields div { display: grid; gap: 4px; }.profile-card__fields span { color: var(--ink-500); font-size: 11px; }.profile-card__fields strong { font-size: 13px; }.profile-card__openid { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.training-panel { padding: 22px; }.training-panel__head { display: flex; justify-content: space-between; gap: 16px; align-items: start; }.training-panel__eyebrow { color: var(--brand-700); font-size: 11px; font-weight: 800; letter-spacing: .1em; }.training-panel h2 { margin: 6px 0 0; color: var(--ink-950); font-size: 20px; }.training-panel__metrics { display: grid; grid-template-columns: repeat(4, 1fr); margin: 20px 0; }.training-panel__metrics > div { padding: 0 18px; border-left: 1px solid rgba(148, 180, 214, .16); }.training-panel__metrics > div:first-child { padding-left: 0; border-left: 0; }.training-panel__metrics span, .training-panel__metrics small { display: block; color: var(--ink-500); font-size: 12px; }.training-panel__metrics strong { display: block; margin: 8px 0 5px; color: var(--ink-950); font-size: 28px; }
.trend-chart { padding: 16px; border-radius: 16px; background: rgba(232, 242, 250, .74); }.trend-chart__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }.trend-chart__head strong, .trend-chart__head small { display: block; }.trend-chart__head strong { color: var(--ink-900); font-size: 14px; }.trend-chart__head small { margin-top: 4px; color: var(--ink-500); font-size: 11px; }.trend-chart__filters { display: flex; flex-wrap: wrap; gap: 6px; }.trend-chart__filters button { min-height: 28px; padding: 0 9px; border: 1px solid rgba(148, 180, 214, .25); border-radius: 999px; background: #fff; color: var(--ink-500); font-size: 11px; cursor: pointer; }.trend-chart__filters button.active { border-color: var(--brand-500); background: rgba(79, 195, 247, .14); color: var(--brand-700); font-weight: 700; }.trend-chart__body { margin-top: 12px; }.trend-chart svg { display: block; width: 100%; height: 154px; overflow: visible; }.trend-chart__grid { stroke: rgba(148, 180, 214, .28); stroke-dasharray: 4 5; }.trend-chart__line { stroke: var(--brand-500); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }.trend-chart__point { stroke: #fff; stroke-width: 2; }.trend-chart__point--good { fill: var(--success); }.trend-chart__point--warning { fill: var(--warning); }.trend-chart__point--danger { fill: var(--danger); }.trend-chart__axis { display: flex; justify-content: space-between; color: var(--ink-500); font-size: 11px; }.trend-chart__empty { margin-top: 12px; padding: 30px 0; text-align: center; color: var(--ink-500); font-size: 12px; }
@media (max-width: 900px) { .profile-overview { grid-template-columns: 1fr; }.training-panel__metrics { grid-template-columns: repeat(2, 1fr); gap: 18px; }.training-panel__metrics > div:nth-child(3) { padding-left: 0; border-left: 0; } }
@media (max-width: 720px) { .training-panel__metrics { grid-template-columns: 1fr; }.training-panel__metrics > div { padding-left: 0; border-left: 0; } }
</style>
