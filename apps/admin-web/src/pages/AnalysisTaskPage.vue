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

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">任务队列</div>
            <div class="section-header__subtitle">失败、质量不足和待复核任务可由管理员重新加入队列；处理中任务不允许重复投递。</div>
          </div>
          <div class="toolbar-group">
            <el-select v-model="status" clearable placeholder="全部状态" style="width: 160px" @change="reload">
              <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
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
        <el-table-column label="队列 / 补偿" min-width="170">
          <template #default="{ row }">
            <div>{{ row.taskStatus || '未创建任务' }}</div>
            <small v-if="row.retryAt" class="muted">下次重试：{{ formatTime(row.retryAt) }}</small>
            <small v-else-if="row.retryCount" class="muted">已重试 {{ row.retryCount }} 次</small>
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
import { getAdminAnalysisTasks, reanalyzeVideo, type AdminAnalysisTaskItem, type AdminAnalysisTaskPage } from '@/services/video';
import { isAdmin } from '@/utils/permission';

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const loadError = ref('');
const status = ref(typeof route.query.status === 'string' ? route.query.status : '');
const retryingId = ref<number | null>(null);
const selectedReanalyzeTask = ref<AdminAnalysisTaskItem | null>(null);
const reanalyzeDialogVisible = ref(false);
const canReanalyze = computed(() => isAdmin());
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
function formatTime(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }

async function load(page = taskPage.value.page) {
  loading.value = true;
  loadError.value = '';
  try {
    taskPage.value = await getAdminAnalysisTasks({ page, limit: taskPage.value.limit, status: status.value || undefined });
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
.muted { display: block; color: var(--ink-500); font-size: 12px; margin-top: 3px; }
.pagination-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; color: var(--ink-500); }
.reanalyze-dialog__message { margin: 0; color: var(--ink-600); line-height: 1.7; }
</style>
