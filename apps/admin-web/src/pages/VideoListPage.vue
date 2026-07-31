<template>
  <div class="admin-page video-list-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Training Archive</div>
          <h1 class="page-hero__title">视频记录中心</h1>
          <p class="page-hero__subtitle">
            汇总患者训练视频的上传状态、分析结果和质量情况，快速进入详情查看失败原因与分数表现。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">共 {{ total }} 条记录</span>
            <span class="page-pill">完成分析 {{ completedCount }} 条</span>
            <span class="page-pill">异常/失败 {{ riskCount }} 条</span>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">当前成功率</div>
            <div class="hero-glass-card__value">{{ successRate }}%</div>
            <div class="hero-glass-card__hint">已完成分析 / 全部记录</div>
          </div>
        </div>
      </div>
    </section>

    <section class="summary-grid">
      <article class="summary-card">
        <div class="summary-card__label">待分析</div>
        <div class="summary-card__value summary-card__value--sm">{{ queueCount }}</div>
        <div class="summary-card__foot">
          <span>待创建、上传中、排队中、分析中</span>
          <span class="summary-card__icon"><el-icon><VideoCamera /></el-icon></span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">质量不足</div>
        <div class="summary-card__value summary-card__value--sm">{{ qualityRiskCount }}</div>
        <div class="summary-card__foot">
          <span>建议复查拍摄和上传环节</span>
          <span class="summary-card__icon"><el-icon><Setting /></el-icon></span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">失败任务</div>
        <div class="summary-card__value summary-card__value--sm">{{ failedCount }}</div>
        <div class="summary-card__foot">
          <span>可进入详情查看失败原因</span>
          <span class="summary-card__icon"><el-icon><TrendCharts /></el-icon></span>
        </div>
      </article>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">视频记录列表</div>
            <div class="section-header__subtitle">支持按状态快速筛查问题视频，提升医护跟进效率。</div>
          </div>
          <div class="toolbar-group">
            <span class="page-pill page-pill--light">当前页 {{ videos.length }} 条</span>
            <el-button type="primary" @click="loadData" :loading="loading">刷新数据</el-button>
          </div>
        </div>
      </template>

      <div class="filter-shell filter-shell--stacked">
        <div class="filter-shell__meta">
          <span class="filter-shell__hint">先按状态筛掉异常记录，再进入详情页排查质量与失败原因。</span>
        </div>
        <div class="toolbar-group">
          <el-select v-model="statusFilter" placeholder="按状态筛选" clearable style="width: 180px">
            <el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </div>
      </div>

      <div class="table-shell" v-loading="loading">
        <el-table :data="filteredVideos" stripe style="width: 100%">
          <el-table-column prop="videoId" label="ID" width="88" />
          <el-table-column prop="actionType" label="动作类型" min-width="150">
            <template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template>
          </el-table-column>
          <el-table-column prop="patientName" label="患者" min-width="120">
            <template #default="{ row }">{{ row.patientName || '未命名患者' }}</template>
          </el-table-column>
          <el-table-column prop="status" label="分析状态" width="140">
            <template #default="{ row }">
              <span class="soft-tag" :class="tagClass(row.status)">{{ statusLabel(row.status) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="qualityStatus" label="质量标签" width="150">
            <template #default="{ row }">{{ qualityLabel(row.qualityStatus) }}</template>
          </el-table-column>
          <el-table-column prop="uploadedAt" label="上传时间" min-width="180">
            <template #default="{ row }">
              <div v-if="row.uploadedAt" class="time-cell">
                <span class="time-cell__main">{{ formatDateTime(row.uploadedAt) }}</span>
                <span class="time-cell__relative">{{ formatRelativeTime(row.uploadedAt) }}</span>
              </div>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="router.push(`/videos/${row.videoId}`)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="pagination-bar">
        <span>共 {{ total }} 条</span>
        <el-pagination background layout="sizes, prev, pager, next" :current-page="page" :page-size="limit" :page-sizes="[10, 20, 50]" :total="total" @current-change="loadData" @size-change="handlePageSizeChange" />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Setting, TrendCharts, VideoCamera } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getAdminVideoList, type AdminVideoItem } from '@/services/video';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';

const router = useRouter();
const videos = ref<AdminVideoItem[]>([]);
const loading = ref(false);
const statusFilter = ref<AnalysisStatus | ''>('');
const total = ref(0);
const page = ref(1);
const limit = ref(10);

const statusOptions = [
  'pending',
  'uploading',
  'queued',
  'processing',
  'completed',
  'failed',
  'quality_insufficient',
].map((status) => ({
  value: status as AnalysisStatus,
  label: (ANALYSIS_STATUS_LABELS as any)[status] || status,
}));

const filteredVideos = computed(() => {
  if (!statusFilter.value) return videos.value;
  return videos.value.filter((item) => item.status === statusFilter.value);
});

const completedCount = computed(() => videos.value.filter((item) => item.status === 'completed').length);
const failedCount = computed(() => videos.value.filter((item) => item.status === 'failed').length);
const qualityRiskCount = computed(() => videos.value.filter((item) => item.status === 'quality_insufficient').length);
const queueCount = computed(() => videos.value.filter((item) => ['pending', 'uploading', 'queued', 'processing'].includes(item.status)).length);
const riskCount = computed(() => videos.value.filter((item) => ['failed', 'quality_insufficient'].includes(item.status)).length);
const successRate = computed(() => {
  if (!videos.value.length) return 0;
  return Math.round((completedCount.value / videos.value.length) * 100);
});

function actionTypeLabel(type: TrainingActionType): string {
  const map: Record<string, string> = {
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
  };
  return map[type] || type;
}

function statusLabel(status: AnalysisStatus): string {
  return (ANALYSIS_STATUS_LABELS as any)[status] || status;
}

function tagClass(status: AnalysisStatus): string {
  const map: Record<string, string> = {
    pending: 'soft-tag--info',
    uploading: 'soft-tag--info',
    queued: 'soft-tag--warning',
    processing: 'soft-tag--warning',
    completed: 'soft-tag--success',
    failed: 'soft-tag--danger',
    quality_insufficient: 'soft-tag--danger',
  };
  return map[status] || 'soft-tag--info';
}

function qualityLabel(status?: string | null): string {
  if (!status) return '待评估';
  if (status === 'pass') return '质量通过';
  if (status === 'insufficient') return '质量不足';
  return '未知状态';
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}年${values.month}月${values.day}日 ${values.hour}:${values.minute}`;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  const key = (input: Date) => formatter.format(input);
  const toUtcDay = (input: Date) => new Date(`${key(input)}T00:00:00Z`).getTime();
  const dayDiff = Math.round((toUtcDay(now) - toUtcDay(date)) / 86400000);
  if (dayDiff === 0) return '今天上传';
  if (dayDiff === 1) return '昨天上传';
  if (dayDiff === 2) return '前天上传';
  if (dayDiff > 2 && dayDiff < 7) return `${dayDiff} 天前上传`;
  return '较早上传';
}

function handlePageSizeChange(nextLimit: number) {
  limit.value = nextLimit;
  loadData(1);
}

async function loadData(nextPage = page.value) {
  loading.value = true;
  try {
    const response = await getAdminVideoList({ page: nextPage, limit: limit.value });
    videos.value = response.items;
    total.value = response.total;
    page.value = response.page;
    limit.value = response.limit;
  } catch (error: any) {
    videos.value = [];
    total.value = 0;
    ElMessage.error(error?.response?.data?.message || '加载视频列表失败');
  } finally {
    loading.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.time-cell { display: flex; flex-direction: column; gap: 3px; line-height: 1.25; }
.time-cell__main { color: var(--ink-800); font-size: 12px; font-weight: 700; }
.time-cell__relative { color: var(--ink-500); font-size: 11px; }
.pagination-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; color: var(--ink-500); }
</style>
