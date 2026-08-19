<template>
  <div class="admin-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Analysis Operations</div>
          <h1 class="page-hero__title">分析任务监控</h1>
          <p class="page-hero__subtitle">集中查看视频分析进度、失败原因和补偿重试状态；重新分析不会影响原始视频与训练记录。</p>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">当前列表</div>
            <div class="hero-glass-card__value">{{ taskPage.total }}</div>
            <div class="hero-glass-card__hint">按创建时间倒序</div>
          </div>
        </div>
      </div>
    </section>

    <el-alert
      v-if="healthError"
      type="warning"
      :closable="false"
      show-icon
      class="task-alert"
      title="队列健康概览加载失败"
      :description="healthError"
    />
    <section v-else-if="analysisHealth" class="health-grid">
      <div class="health-card"><span>可自动恢复上传</span><strong>{{ analysisHealth.uploads.recoverable }}</strong><small>创建后 1～15 分钟，恢复器会自动校验并入队</small></div>
      <div class="health-card"><span>历史未完成上传</span><strong>{{ analysisHealth.uploads.expired }}</strong><small>超过 15 分钟，通常为用户取消或上传中断，不计为分析失败</small></div>
      <div class="health-card"><span>队列等待</span><strong>{{ analysisHealth.tasks['queued:null'] || analysisHealth.tasks['queued:enqueue_retry_pending'] || 0 }}</strong><small>{{ oldestQueuedHint }}</small></div>
      <div class="health-card"><span>分析处理中</span><strong>{{ processingTaskCount }}</strong><small>{{ oldestProcessingHint }}</small></div>
      <div class="health-card"><span>自动补偿中</span><strong>{{ retryPendingTaskCount }}</strong><small>入队失败会由协调器自动重试</small></div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">任务队列</div>
            <div class="section-header__subtitle">失败、质量不足和待复核任务可由管理员重新加入队列；处理中任务不允许重复投递。</div>
          </div>
          <div class="toolbar-group">
            <el-input
              v-model="keyword"
              clearable
              placeholder="搜索视频 ID、患者或动作"
              style="width: 240px"
              @keyup.enter="reload"
              @clear="reload"
            />
            <el-select v-model="status" clearable placeholder="全部状态" style="width: 160px" @change="reload">
              <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-button type="primary" plain :loading="loading" @click="reload">搜索</el-button>
            <el-button :loading="loading" @click="reload">刷新</el-button>
          </div>
        </div>
      </template>

      <el-alert v-if="loadError" type="error" :closable="false" show-icon class="task-alert" title="任务列表加载失败" :description="loadError" />
      <el-table v-loading="loading" :data="taskPage.items" stripe>
        <el-table-column prop="videoId" label="视频 ID" width="94" />
        <el-table-column label="来源 / 患者" min-width="145">
          <template #default="{ row }">
            <div>{{ row.patientName }}</div>
            <small class="muted">{{ sourceLabel(row.sourceType) }}</small>
          </template>
        </el-table-column>
        <el-table-column label="动作" min-width="110">
          <template #default="{ row }">{{ actionLabel(row.actionType) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="125">
          <template #default="{ row }"><el-tag :type="tagType(row.analysisStatus)">{{ statusLabel(row.analysisStatus) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="队列 / 补偿" min-width="220">
          <template #default="{ row }">
            <div>{{ queueStatusLabel(row) }}</div>
            <small v-if="row.retryAt" class="muted">自动补偿下次执行：{{ formatTime(row.retryAt) }}</small>
            <small v-else-if="row.retryCount" class="muted">自动补偿入队失败 {{ row.retryCount }} 次</small>
            <small v-if="row.manualRetryCount" class="muted">管理员重新分析 {{ row.manualRetryCount }} 次</small>
          </template>
        </el-table-column>
        <el-table-column label="失败或质量原因" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ row.failReason || qualityLabel(row.qualityStatus) }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="175">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/videos/${row.videoId}`)">详情</el-button>
            <el-tooltip v-if="row.canReanalyze" :disabled="canReanalyze" content="需要管理员权限才能重新分析" placement="top"><el-button link type="warning" :disabled="!canReanalyze" :loading="retryingId === row.videoId" @click="confirmReanalyze(row)">重新分析</el-button></el-tooltip>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-bar">
        <span>共 {{ taskPage.total }} 条</span>
        <el-pagination background layout="sizes, prev, pager, next" :current-page="taskPage.page" :page-size="taskPage.limit" :page-sizes="[10, 20, 50]" :total="taskPage.total" @current-change="changePage" @size-change="changePageSize" />
      </div>
    </el-card>

    <el-dialog v-model="reanalyzeDialogVisible" title="确认重新分析" width="420px" :close-on-click-modal="false" :close-on-press-escape="!retryingId">
      <p class="reanalyze-dialog__message">将重新分析视频 #{{ selectedReanalyzeTask?.videoId }}。原始视频会保留，当前结果将在新任务完成后更新。</p>
      <template #footer>
        <el-button :disabled="Boolean(retryingId)" @click="closeReanalyzeDialog">取消</el-button>
        <el-button type="warning" :loading="Boolean(retryingId)" @click="submitReanalyze">确认加入队列</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute, useRouter } from 'vue-router';
import { getAdminAnalysisHealth, getAdminAnalysisTasks, reanalyzeVideo, type AdminAnalysisHealth, type AdminAnalysisTaskItem, type AdminAnalysisTaskPage } from '@/services/video';
import { isAdmin } from '@/utils/permission';

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const loadError = ref('');
const healthError = ref('');
const analysisHealth = ref<AdminAnalysisHealth | null>(null);
const status = ref(typeof route.query.status === 'string' ? route.query.status : '');
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '');
const retryingId = ref<number | null>(null);
const selectedReanalyzeTask = ref<AdminAnalysisTaskItem | null>(null);
const reanalyzeDialogVisible = ref(false);
const canReanalyze = computed(() => isAdmin());
const processingTaskCount = computed(() => Object.entries(analysisHealth.value?.tasks || {}).filter(([key]) => key.startsWith('processing:')).reduce((total, [, count]) => total + count, 0));
const retryPendingTaskCount = computed(() => Object.entries(analysisHealth.value?.tasks || {}).filter(([key]) => key.endsWith(':enqueue_retry_pending')).reduce((total, [, count]) => total + count, 0));
const oldestQueuedHint = computed(() => analysisHealth.value?.oldestQueued ? `最久等待 ${formatElapsed(analysisHealth.value.oldestQueued.waitSeconds)}（#${analysisHealth.value.oldestQueued.videoId}）` : '当前没有排队任务');
const oldestProcessingHint = computed(() => analysisHealth.value?.oldestProcessing ? `最长处理 ${formatElapsed(analysisHealth.value.oldestProcessing.processingSeconds)}（#${analysisHealth.value.oldestProcessing.videoId}）` : '当前没有处理中任务');
const taskPage = ref<AdminAnalysisTaskPage>({ items: [], total: 0, page: 1, limit: 10 });
const statusOptions = [
  ['pending', '待处理'], ['uploading', '上传中'], ['queued', '排队中'], ['processing', '分析中'],
  ['completed', '已完成'], ['failed', '分析失败'], ['quality_insufficient', '质量不足'], ['review_required', '待复核'],
].map(([value, label]) => ({ value, label }));

function statusLabel(value: string) { return statusOptions.find((item) => item.value === value)?.label || value; }
function actionLabel(value: string) { return ({ abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' } as Record<string, string>)[value] || value; }
function sourceLabel(value: string) { return value === 'miniapp' ? '患者上传' : value === 'gold_template' ? '金标准样本' : '内部验证样本'; }
function qualityLabel(value?: string | null) { return value === 'insufficient' ? '视频质量不足，请查看详情' : value === 'pass' ? '质量通过' : '—'; }
function tagType(value: string) { return value === 'completed' ? 'success' : ['failed', 'quality_insufficient'].includes(value) ? 'danger' : value === 'review_required' ? 'warning' : 'info'; }
function queueStatusLabel(row: AdminAnalysisTaskItem) {
  if (row.callbackStatus === 'retry_pending' || row.callbackStatus === 'enqueue_retry_pending') return '等待自动补偿入队';
  if (row.callbackStatus === 'retry_exhausted') return '自动补偿已用尽';
  if (row.taskStatus === 'queued') return '已入队，等待分析服务接单';
  return row.taskStatus || '未创建任务';
}
function formatElapsed(seconds: number | null) {
  if (seconds === null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  return `${Math.floor(seconds / 3600)} 小时`;
}
function formatTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const output = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${output.year}年${output.month}月${output.day}日 ${output.hour}:${output.minute}`;
}

async function load(page = taskPage.value.page) {
  loading.value = true;
  loadError.value = '';
  try {
    const [taskResult, healthResult] = await Promise.allSettled([
      getAdminAnalysisTasks({
        page,
        limit: taskPage.value.limit,
        status: status.value || undefined,
        keyword: keyword.value.trim() || undefined,
      }),
      getAdminAnalysisHealth(),
    ]);
    if (taskResult.status === 'rejected') throw taskResult.reason;
    taskPage.value = taskResult.value;
    healthError.value = '';
    if (healthResult.status === 'fulfilled') analysisHealth.value = healthResult.value;
    else healthError.value = healthResult.reason?.message || '请检查网络或管理员权限后重试。';
  } catch (error: any) {
    loadError.value = error?.message || '请检查网络或权限后重试。';
  } finally { loading.value = false; }
}
function reload() { load(1); }
function changePage(page: number) { load(page); }
function changePageSize(limit: number) {
  taskPage.value.limit = limit;
  load(1);
}
function confirmReanalyze(row: AdminAnalysisTaskItem) {
  if (!canReanalyze.value) { ElMessage.warning('需要管理员权限才能重新分析'); return; }
  if (retryingId.value !== null) { ElMessage.info('已有重新分析任务正在提交，请稍候'); return; }
  selectedReanalyzeTask.value = row;
  reanalyzeDialogVisible.value = true;
}
function closeReanalyzeDialog() {
  if (retryingId.value !== null) return;
  reanalyzeDialogVisible.value = false;
  selectedReanalyzeTask.value = null;
}
async function submitReanalyze() {
  const row = selectedReanalyzeTask.value;
  if (!row || retryingId.value !== null) return;
  let submitted = false;
  retryingId.value = row.videoId;
  try {
    const result = await reanalyzeVideo(row.videoId);
    submitted = true;
    ElMessage.success(result.message || '已加入重新分析队列');
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || error?.message || '重新分析失败');
  } finally {
    retryingId.value = null;
    if (submitted) closeReanalyzeDialog();
    await load(taskPage.value.page);
  }
}
onMounted(() => load());
</script>

<style scoped>
.task-alert { margin-bottom: 16px; }
.health-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.health-card { display: grid; gap: 5px; min-height: 92px; padding: 14px 16px; border: 1px solid rgba(148, 180, 214, .22); border-radius: 12px; background: linear-gradient(145deg, #fff, #f3f9fc); }
.health-card span, .health-card small { color: var(--ink-500); font-size: 12px; }
.health-card strong { color: var(--ink-900); font-size: 26px; line-height: 1.1; }
@media (max-width: 900px) { .health-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .health-grid { grid-template-columns: 1fr; } }
.muted { display: block; color: var(--ink-500); font-size: 12px; margin-top: 3px; }
.pagination-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; color: var(--ink-500); }
.reanalyze-dialog__message { margin: 0; color: var(--ink-600); line-height: 1.7; }
</style>
