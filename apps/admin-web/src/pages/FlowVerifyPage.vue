<template>
  <div class="admin-page flow-verify-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Flow Verification</div>
          <h1 class="page-hero__title">上传 + 分析 + 结果验证</h1>
          <p class="page-hero__subtitle">
            该页面用于快速验证完整主链路：患者登录、视频上传、创建分析任务、状态轮询、报告结果展示。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">当前状态：{{ statusLabel(currentStatus) }}</span>
            <span class="page-pill" v-if="currentVideoId">视频ID：{{ currentVideoId }}</span>
            <span class="page-pill" v-if="polling">轮询中（{{ pollCount }}）</span>
            <span class="page-pill" v-if="analysisDetailReady">评分明细已加载</span>
          </div>
        </div>
      </div>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">验证参数</div>
            <div class="section-header__subtitle">选择动作和视频，点击开始后自动执行全流程。</div>
          </div>
        </div>
      </template>

      <div class="verify-form-grid">
        <div class="verify-form-item">
          <label class="verify-form-item__label">动作类型</label>
          <el-select v-model="actionType" style="width: 100%">
            <el-option v-for="item in actionOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>

        <div class="verify-form-item verify-form-item--file">
          <label class="verify-form-item__label">训练视频</label>
          <input class="verify-file-input" type="file" accept="video/*" @change="onFileChange" />
          <div class="verify-file-tip" v-if="selectedFileName">
            已选择：{{ selectedFileName }}
            <span v-if="selectedFileSizeLabel">（{{ selectedFileSizeLabel }}）</span>
            <span v-if="videoDurationSeconds">，时长约 {{ videoDurationSeconds }} 秒</span>
          </div>
          <div class="verify-file-tip verify-file-tip--warn" v-else>
            请先选择一个本地视频文件。
          </div>
        </div>
      </div>

      <div class="toolbar-group verify-toolbar">
        <el-button type="primary" :loading="running" @click="startVerification">开始验证流程</el-button>
        <el-button :disabled="!currentVideoId || running" @click="refreshStatus">刷新状态</el-button>
        <el-button :disabled="!polling" @click="stopPolling">停止轮询</el-button>
        <el-button :disabled="running" @click="resetState">重置</el-button>
      </div>

      <div class="verify-error" v-if="errorText">{{ errorText }}</div>
    </el-card>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">视频预览</div>
            <div class="section-header__subtitle">同时查看本地上传视频和服务端落库视频，确认上传内容是否一致。</div>
          </div>
          <div class="section-header__actions" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap">
            <el-tag size="small" type="info">本页可直接看纯骨架，也可跳详情页复核</el-tag>
            <el-button size="small" :disabled="!currentVideoId" @click="goToVideoDetail">
              前往视频详情页
            </el-button>
          </div>
        </div>
      </template>

      <div class="preview-grid">
        <div class="preview-card">
          <div class="preview-card__title">上传前（本地文件）</div>
          <video
            v-if="localPreviewUrl"
            class="preview-card__video"
            :src="localPreviewUrl"
            controls
            playsinline
            preload="metadata"
          ></video>
          <div v-else class="empty-state">请选择视频后可预览本地文件。</div>
        </div>
        <div class="preview-card">
          <div class="preview-card__title">上传后（服务端文件）</div>
          <video
            v-if="uploadedVideoPreviewUrl"
            class="preview-card__video"
            :src="uploadedVideoPreviewUrl"
            controls
            playsinline
            preload="metadata"
          ></video>
          <div v-else class="empty-state">分析完成后会显示服务端视频预览。</div>
        </div>
      </div>

      <div class="skeleton-inline">
        <div class="skeleton-inline__header">
          <div class="skeleton-inline__title">骨架分析对比（可切换“纯骨架”）</div>
          <el-button
            size="small"
            :disabled="!currentVideoId"
            :loading="keypointsLoading"
            @click="loadKeypointsForCurrentVideo()"
          >
            {{ keypointsData ? '重新加载骨架数据' : '加载骨架数据' }}
          </el-button>
        </div>

        <SkeletonOverlay
          v-if="uploadedVideoPreviewUrl && keypointsData && keypointsData.total_frames > 0"
          :videoUrl="uploadedVideoPreviewUrl"
          :keypointsData="keypointsData"
          :summaryTotalReps="analysisDetail?.summary?.totalReps ?? 0"
          :summaryValidReps="analysisDetail?.summary?.validReps ?? 0"
        />

        <el-alert
          v-else-if="keypointsData && keypointsData.total_frames === 0"
          type="warning"
          :closable="false"
          :title="keypointsData.message || '当前视频暂无关键点数据'"
        />

        <el-empty
          v-else
          description="完成分析后点击“加载骨架数据”，然后在组件里点“纯骨架”即可"
          :image-size="72"
        />
      </div>
    </el-card>

    <section class="summary-grid">
      <article class="summary-card">
        <div class="summary-card__label">样本来源</div>
        <div class="summary-card__value summary-card__value--sm">内部验证</div>
        <div class="summary-card__foot">
          <span>不会计入患者训练记录与统计</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">任务状态</div>
        <div class="summary-card__value summary-card__value--sm">{{ statusLabel(currentStatus) }}</div>
        <div class="summary-card__foot">
          <span>reportReady：{{ reportReady ? 'true' : 'false' }}</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">分析结果</div>
        <div class="summary-card__value summary-card__value--sm">{{ analysisDetail?.summary?.grade || '-' }}</div>
        <div class="summary-card__foot">
          <span>平均分：{{ analysisDetail?.summary?.averageScore ?? '-' }}</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">识别可信度</div>
        <div class="summary-card__value summary-card__value--sm">{{ analysisDetail?.summary?.confidenceScore ?? '-' }}</div>
        <div class="summary-card__foot">
          <span>准确性判断：{{ accuracyHint }}</span>
        </div>
      </article>
    </section>

    <div class="verify-grid">
      <el-card class="surface-card" shadow="never">
        <template #header>
          <div class="section-header">
            <div>
              <div class="section-header__title">评分与识别明细</div>
              <div class="section-header__subtitle">用于判断当前评分依据、识别出的动作特征和准确性参考。</div>
            </div>
          </div>
        </template>

        <div v-if="analysisDetail" class="analysis-panel">
          <div class="analysis-explain">
            <div class="analysis-explain__title">评分规则（当前服务配置）</div>
            <div class="analysis-explain__line">
              四维权重：准确度 {{ analysisDetail.scoringExplain.weights.accuracy }}，稳定性 {{ analysisDetail.scoringExplain.weights.stability }}，
              控制度 {{ analysisDetail.scoringExplain.weights.control }}，持续度 {{ analysisDetail.scoringExplain.weights.duration }}
            </div>
            <div class="analysis-explain__line">
              分级区间：
              <span v-for="item in analysisDetail.scoringExplain.gradeRanges" :key="item.grade" class="analysis-chip">
                {{ item.grade }} {{ item.min }}-{{ item.max }}
              </span>
            </div>
          <div class="analysis-explain__line">{{ analysisDetail.scoringExplain.scoringHint }}</div>
          <div class="analysis-explain__line analysis-explain__line--pure-skeleton">
            说明：本页面用于流程验证，若要看“纯骨架/骨架+视频”切换，请点上方“前往视频详情看纯骨架”。
          </div>
        </div>


          <div class="analysis-section-title">分次动作评分（rep）</div>
          <div class="analysis-table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>rep</th>
                  <th>总分</th>
                  <th>等级</th>
                  <th>有效</th>
                  <th>准确</th>
                  <th>稳定</th>
                  <th>控制</th>
                  <th>持续</th>
                  <th>代偿项</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in analysisDetail.repScores" :key="`${idx}-${row.repId ?? 'none'}`">
                  <td>{{ row.repId ?? '-' }}</td>
                  <td>{{ row.totalScore ?? '-' }}</td>
                  <td>{{ row.grade || '-' }}</td>
                  <td>{{ row.validFlag ? '是' : '否' }}</td>
                  <td>{{ row.accuracyScore ?? '-' }}</td>
                  <td>{{ row.stabilityScore ?? '-' }}</td>
                  <td>{{ row.controlScore ?? '-' }}</td>
                  <td>{{ row.durationScore ?? '-' }}</td>
                  <td>{{ row.compensationTypes?.length ? row.compensationTypes.join('、') : '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="analysis-section-title">特征对比结果（feature）</div>
          <div class="analysis-table-wrap">
            <table class="analysis-table">
              <thead>
                <tr>
                  <th>rep</th>
                  <th>特征码</th>
                  <th>特征值</th>
                  <th>单位</th>
                  <th>对比标签</th>
                  <th>偏离σ</th>
                  <th>置信度</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, idx) in analysisDetail.featureRows" :key="`${idx}-${row.featureCode}-${row.repId ?? 'none'}`">
                  <td>{{ row.repId ?? '-' }}</td>
                  <td>{{ row.featureCode }}</td>
                  <td>{{ row.value ?? '-' }}</td>
                  <td>{{ row.unit || '-' }}</td>
                  <td>
                    <span :class="['analysis-tag', featureTagClass(row.compareLabel)]">{{ row.compareLabel || '-' }}</span>
                  </td>
                  <td>{{ row.deviationSigma ?? '-' }}</td>
                  <td>{{ row.confidence ?? '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="analysis-note">
            建议判断准确性时重点看：
            1）compareLabel 中 invalid/warning 占比；
            2）deviationSigma 是否普遍大于 1.5；
            3）validReps / totalReps；
            4）confidenceScore 与 qualityScore 是否偏低。
          </div>
        </div>
        <div v-else class="empty-state">暂无评分明细，请先完成一次分析或手动点击“刷新状态”。</div>
      </el-card>

      <el-card class="surface-card" shadow="never">
        <template #header>
          <div class="section-header">
            <div>
              <div class="section-header__title">流程日志</div>
              <div class="section-header__subtitle">每一步实时记录，便于快速排查。</div>
            </div>
          </div>
        </template>

        <div class="log-panel">
          <div v-if="!logs.length" class="empty-state">点击“开始验证流程”后会显示执行日志。</div>
          <div v-for="(item, idx) in logs" :key="`${idx}-${item}`" class="log-line">{{ item }}</div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { ElMessage } from 'element-plus';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import type { KeypointsData } from '@/services/video';
import SkeletonOverlay from '@/components/SkeletonOverlay.vue';

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type PresignData = {
  videoId: number;
  uploadUrl: string;
  objectKey: string;
  uploadType?: 'local_proxy' | 's3_post';
  uploadFields?: Record<string, string>;
};

type VideoStatusData = {
  videoId: number;
  status: AnalysisStatus;
  reportReady: boolean;
};

type AnalysisDetailData = {
  videoId: number;
  actionType: TrainingActionType;
  analysisStatus: AnalysisStatus;
  taskStatus: string;
  qualityStatus: string | null;
  qualityScore: number | null;
  failReason: string | null;
  videoKey: string | null;
  videoPreviewUrl: string | null;
  reportReady: boolean;
  summary: {
    averageScore: number | null;
    grade: string | null;
    totalReps: number;
    validReps: number;
    confidenceScore: number | null;
    accuracyAvg: number | null;
    stabilityAvg: number | null;
    controlAvg: number | null;
    durationAvg: number | null;
    avgHoldDuration: number | null;
    mainIssues: unknown[];
    adviceSummary: unknown[];
  } | null;
  scoringExplain: {
    gradeRanges: Array<{ min: number; max: number; grade: string }>;
    weights: { accuracy: number; stability: number; control: number; duration: number };
    scoringHint: string;
  };
  repScores: Array<{
    repId: number | null;
    accuracyScore: number | null;
    stabilityScore: number | null;
    controlScore: number | null;
    durationScore: number | null;
    totalScore: number | null;
    grade: string | null;
    validFlag: boolean;
    holdDuration: number | null;
    compensationTypes: string[];
  }>;
  featureRows: Array<{
    repId: number | null;
    featureCode: string;
    value: number | null;
    unit: string | null;
    compareLabel: string | null;
    deviationSigma: number | null;
    confidence: number | null;
  }>;
};

function normalizeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (!raw) return fallback;

  let statusCode = 0;
  let backendMessage = '';

  if (axios.isAxiosError(error)) {
    statusCode = Number(error.response?.status || 0);
    const data = error.response?.data as { message?: string | { message?: string }; detail?: string } | string | undefined;
    if (typeof data === 'string') {
      backendMessage = data;
    } else {
      const rawMessage = data?.message;
      backendMessage = typeof rawMessage === 'string'
        ? rawMessage
        : rawMessage?.message || data?.detail || '';
    }
  }

  const merged = `${raw} ${backendMessage}`;

  if (statusCode === 503 || merged.includes('status code 503') || merged.includes('Service Unavailable')) {
    return '分析服务暂时不可用，请稍后重试';
  }
  if (statusCode === 502 || statusCode === 504 || merged.includes('status code 502') || merged.includes('status code 504')) {
    return '分析链路暂时不稳定，请稍后重试';
  }
  if (statusCode === 401 || merged.includes('status code 401')) {
    return '登录状态已失效，请重新登录后重试';
  }
  if (statusCode === 403 || merged.includes('status code 403')) {
    return backendMessage ? `权限校验失败：${backendMessage}` : '当前账号没有执行内部验证的权限';
  }
  if (statusCode === 400 || merged.includes('status code 400')) {
    return backendMessage ? `请求参数异常：${backendMessage}` : '请求参数异常，请重新选择视频后重试';
  }
  if (merged.includes('timeout') || merged.includes('timed out')) {
    return '请求超时，请检查网络后重试';
  }

  return backendMessage || raw;
}

const api = axios.create({
  baseURL: '/api',
  timeout: 20_000,
});

const router = useRouter();

const actionOptions: Array<{ label: string; value: TrainingActionType }> = [
  { label: '缩腹运动', value: 'abdominal_crunch' },
  { label: '骨盆倾斜', value: 'pelvic_tilt' },
  { label: '膝关节旋转', value: 'knee_rotation' },
];

const actionType = ref<TrainingActionType>('abdominal_crunch');

const selectedFile = ref<File | null>(null);
const selectedFileName = ref('');
const selectedFileSizeLabel = ref('');
const videoDurationSeconds = ref(0);

const currentVideoId = ref<number | null>(null);
const currentStatus = ref<AnalysisStatus>('pending');
const reportReady = ref(false);
const pollCount = ref(0);

const analysisDetail = ref<AnalysisDetailData | null>(null);
const keypointsData = ref<KeypointsData | null>(null);
const keypointsLoading = ref(false);
const logs = ref<string[]>([]);
const errorText = ref('');

const running = ref(false);
const polling = ref(false);

let pollingTimer: number | null = null;

const localPreviewUrl = ref('');


const analysisDetailReady = computed(() => Boolean(analysisDetail.value));

const uploadedVideoPreviewUrl = computed(() => {
  const value = analysisDetail.value?.videoPreviewUrl || '';
  if (!value) return '';
  return value.startsWith('http') ? value : `${window.location.origin}${value}`;
});

const accuracyHint = computed(() => {
  const detail = analysisDetail.value;
  if (!detail || !detail.summary) return '-';

  const total = detail.summary.totalReps || 0;
  const valid = detail.summary.validReps || 0;
  const validRate = total > 0 ? valid / total : 0;
  const confidence = Number(detail.summary.confidenceScore || 0);
  const invalidCount = detail.featureRows.filter((item) => item.compareLabel === 'invalid').length;

  if (confidence >= 0.8 && validRate >= 0.7 && invalidCount <= 2) {
    return '较高（可作为训练反馈）';
  }
  if (confidence >= 0.65 && validRate >= 0.5) {
    return '中等（建议结合视频复核）';
  }
  return '偏低（建议重录并复核）';
});

function unwrap<T>(payload: ApiEnvelope<T>): T {
  if (!payload?.success) {
    throw new Error(payload?.message || '请求失败');
  }
  return payload.data;
}

function appendLog(message: string) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  logs.value.push(`[${time}] ${message}`);
}

function actionLabel(type: TrainingActionType) {
  return actionOptions.find((item) => item.value === type)?.label || type;
}

function statusLabel(status: AnalysisStatus | string) {
  return (ANALYSIS_STATUS_LABELS as Record<string, string>)[status] || status;
}

function featureTagClass(label?: string | null) {
  if (label === 'normal') return 'analysis-tag--normal';
  if (label === 'warning') return 'analysis-tag--warning';
  if (label === 'invalid') return 'analysis-tag--invalid';
  return '';
}

function normalizeUploadUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith('/api/')) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return url;
  } catch {
    return url;
  }
}


function adminAuthHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}`,
  };
}

function formatSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)}KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function revokeLocalPreview() {
  if (localPreviewUrl.value) {
    URL.revokeObjectURL(localPreviewUrl.value);
    localPreviewUrl.value = '';
  }
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const src = URL.createObjectURL(file);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      URL.revokeObjectURL(src);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(src);
      resolve(0);
    };

    video.src = src;
  });
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  selectedFile.value = file;
  selectedFileName.value = file.name;
  selectedFileSizeLabel.value = formatSize(file.size);
  videoDurationSeconds.value = await getVideoDuration(file);
  errorText.value = '';
  revokeLocalPreview();
  localPreviewUrl.value = URL.createObjectURL(file);

  appendLog(`选择视频：${file.name}（${selectedFileSizeLabel.value}）`);
}


async function fetchAnalysisDetail(videoId: number) {
  const response = await api.get<ApiEnvelope<AnalysisDetailData>>(`/videos/admin/${videoId}/analysis-detail`, {
    headers: adminAuthHeaders(),
  });
  analysisDetail.value = unwrap(response.data);
  appendLog(`评分明细已获取：reps=${analysisDetail.value.repScores.length}, features=${analysisDetail.value.featureRows.length}`);
}

async function fetchKeypoints(videoId: number) {
  const response = await api.get<ApiEnvelope<KeypointsData>>(`/videos/admin/${videoId}/keypoints`, {
    headers: adminAuthHeaders(),
  });
  keypointsData.value = unwrap(response.data);
  appendLog(`关键点已获取：frames=${keypointsData.value.total_frames}`);
}

async function loadKeypointsForCurrentVideo(showSuccessToast = true) {
  if (!currentVideoId.value) {
    ElMessage.warning('请先完成一次流程验证');
    return;
  }

  keypointsLoading.value = true;
  try {
    await fetchKeypoints(currentVideoId.value);
    if (showSuccessToast) {
      ElMessage.success('骨架数据加载完成，可切换到“纯骨架”模式查看');
    }
  } catch (error) {
    const msg = normalizeErrorMessage(error, '加载骨架数据失败');
    ElMessage.warning(msg);
  } finally {
    keypointsLoading.value = false;
  }
}

async function getStatus(videoId: number): Promise<VideoStatusData> {
const response = await api.get<ApiEnvelope<VideoStatusData>>(`/videos/admin/internal-samples/${videoId}/status`, {
headers: adminAuthHeaders(),
});
return unwrap(response.data);
}

function clearPollingTimer() {
  if (pollingTimer !== null) {
    window.clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

function stopPolling() {
  polling.value = false;
  clearPollingTimer();
  appendLog('已停止轮询。');
}

async function pollUntilFinish(videoId: number) {
  const maxPollCount = 90;
  const intervalMs = 2000;

  polling.value = true;
  pollCount.value = 0;

  const loop = async () => {
    if (!polling.value) return;

    pollCount.value += 1;
    const statusData = await getStatus(videoId);
    currentStatus.value = statusData.status;
    reportReady.value = statusData.reportReady;

    appendLog(`轮询#${pollCount.value}：status=${statusData.status}, reportReady=${statusData.reportReady}`);

if (statusData.status === 'completed' && statusData.reportReady) {
polling.value = false;
await Promise.all([fetchAnalysisDetail(videoId), fetchKeypoints(videoId)]);
ElMessage.success('流程验证完成，评分明细和骨架数据已获取');
return;
}

    if (statusData.status === 'failed' || statusData.status === 'quality_insufficient') {
      polling.value = false;
      ElMessage.warning(`流程结束：${statusLabel(statusData.status)}`);
      return;
    }

    if (pollCount.value >= maxPollCount) {
      polling.value = false;
      errorText.value = '轮询超时，请检查分析服务或任务队列状态。';
      appendLog('轮询超时，流程中断。');
      ElMessage.warning('轮询超时');
      return;
    }

    pollingTimer = window.setTimeout(() => {
      loop().catch((error) => {
        polling.value = false;
        errorText.value = normalizeErrorMessage(error, '轮询失败');
        appendLog(`轮询失败：${errorText.value}`);
      });
    }, intervalMs);
  };

  await loop();
}

async function refreshStatus() {
  if (!currentVideoId.value) {
    ElMessage.warning('请先发起一次验证流程');
    return;
  }

  try {
    const statusData = await getStatus(currentVideoId.value);
    currentStatus.value = statusData.status;
    reportReady.value = statusData.reportReady;
    appendLog(`手动刷新状态：status=${statusData.status}`);

    if (statusData.status === 'completed' && statusData.reportReady) {
      await Promise.all([
        fetchAnalysisDetail(currentVideoId.value),
        fetchKeypoints(currentVideoId.value),
      ]);
    }
  } catch (error) {
    const msg = normalizeErrorMessage(error, '刷新状态失败');
    errorText.value = msg;
    ElMessage.error(msg);
  }
}

function resetState() {
  stopPolling();
  errorText.value = '';
    analysisDetail.value = null;
  keypointsData.value = null;
  currentVideoId.value = null;
  currentStatus.value = 'pending';
  reportReady.value = false;
  pollCount.value = 0;
  logs.value = [];
  appendLog('状态已重置。');
}

function goToVideoDetail() {
  if (!currentVideoId.value) {
    ElMessage.warning('暂无可跳转的视频，请先完成一次流程验证');
    return;
  }
  router.push(`/videos/${currentVideoId.value}`);
}

async function startVerification() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择视频');
    return;
  }

  running.value = true;
  errorText.value = '';
    analysisDetail.value = null;
  keypointsData.value = null;
  clearPollingTimer();

try {
appendLog('步骤1：创建流程验证内部样本');
const presignResponse = await api.get<ApiEnvelope<PresignData>>('/videos/admin/internal-samples/admin_flow_verify/presign-upload', {
params: { actionType: form.actionType },
headers: adminAuthHeaders(),
});
    const presign = unwrap(presignResponse.data);
    currentVideoId.value = presign.videoId;
    currentStatus.value = 'uploading';

    appendLog(`步骤2：上传视频（videoId=${presign.videoId}）`);
    const uploadUrl = normalizeUploadUrl(presign.uploadUrl);

    if (presign.uploadType === 's3_post' && presign.uploadFields) {
      appendLog('检测到直传模式（s3_post），使用预签名字段上传');
      const formData = new FormData();
      for (const [key, value] of Object.entries(presign.uploadFields)) {
        formData.append(key, value);
      }
      formData.append('file', selectedFile.value, selectedFile.value.name);

      await axios.post(uploadUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120_000,
      });
      appendLog(`上传完成：objectKey=${presign.objectKey}`);
    } else {
      const formData = new FormData();
      formData.append('file', selectedFile.value, selectedFile.value.name);

      const uploadResponse = await axios.post<ApiEnvelope<{ objectKey: string; size: number }>>(
        uploadUrl,
        formData,
        {
headers: {
...adminAuthHeaders(),
'Content-Type': 'multipart/form-data',
},
          timeout: 120_000,
        },
      );
      const uploadData = unwrap(uploadResponse.data);
      appendLog(`上传完成：objectKey=${uploadData.objectKey}`);
    }

    appendLog('步骤3：确认上传并创建分析任务（confirm-upload）');
    const duration = videoDurationSeconds.value > 0 ? videoDurationSeconds.value : 30;
    const confirmResponse = await api.post<ApiEnvelope<{ status: AnalysisStatus }>>(
      `/videos/admin/internal-samples/${presign.videoId}/confirm-upload`,
      {
        videoId: presign.videoId,
        actionType: actionType.value,
        duration,
      },
      {
        headers: adminAuthHeaders(),
      },
    );
    const confirmData = unwrap(confirmResponse.data);
    currentStatus.value = confirmData.status;
    appendLog(`任务已创建：status=${confirmData.status}`);

    appendLog('步骤4：开始轮询分析状态');
    await pollUntilFinish(presign.videoId);
  } catch (error) {
    const msg = normalizeErrorMessage(error, '流程执行失败');
    errorText.value = msg;
    appendLog(`流程失败：${msg}`);
    ElMessage.error(msg);
  } finally {
    running.value = false;
  }
}

onBeforeUnmount(() => {
  clearPollingTimer();
  revokeLocalPreview();
});

onUnmounted(() => {
  revokeLocalPreview();
});
</script>

<style scoped>
.verify-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 16px;
}

.verify-form-item {
  display: grid;
  gap: 8px;
}

.verify-form-item--file {
  grid-column: 1 / -1;
}

.verify-form-item__label {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
}

.verify-file-input {
  width: 100%;
  border: 1px dashed rgba(148, 180, 214, 0.45);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--ink-700);
  background: rgba(248, 251, 255, 0.7);
}

.verify-file-tip {
  color: var(--ink-500);
  font-size: 12px;
  line-height: 1.7;
}

.verify-file-tip--warn {
  color: #b26a2b;
}

.verify-toolbar {
  margin-top: 14px;
}

.verify-error {
  margin-top: 12px;
  border-radius: 12px;
  background: rgba(255, 113, 113, 0.12);
  color: #b03939;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.7;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.preview-card {
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  background: rgba(248, 251, 255, 0.72);
  padding: 12px;
}

.preview-card__title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}

.preview-card__video {
  width: 100%;
  max-height: 320px;
  border-radius: 10px;
  background: #0e1b2d;
}

.skeleton-inline {
  margin-top: 14px;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  background: rgba(248, 251, 255, 0.72);
  padding: 12px;
}

.skeleton-inline__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.skeleton-inline__title {
  color: var(--ink-700);
  font-size: 13px;
  font-weight: 700;
}

.verify-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

.report-grid {
  display: grid;
  gap: 10px;
}

.report-item {
  display: grid;
  gap: 6px;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(248, 251, 255, 0.72);
}

.report-item__label {
  color: var(--ink-500);
  font-size: 12px;
}

.report-item__value {
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.analysis-panel {
  display: grid;
  gap: 14px;
}

.analysis-explain {
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  background: rgba(248, 251, 255, 0.72);
  padding: 12px 14px;
}

.analysis-explain__title {
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.analysis-explain__line {
  margin-top: 8px;
  color: var(--ink-700);
  font-size: 13px;
  line-height: 1.8;
}

.analysis-explain__line--pure-skeleton {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(76, 140, 255, 0.12);
  color: #2a4d8f;
}

.analysis-chip {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  min-height: 24px;
  background: rgba(15, 40, 79, 0.08);
  color: var(--ink-700);
  margin-right: 8px;
}

.analysis-section-title {
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 700;
}

.analysis-table-wrap {
  overflow: auto;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
}

.analysis-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.analysis-table th,
.analysis-table td {
  border-bottom: 1px solid rgba(148, 180, 214, 0.18);
  padding: 8px 10px;
  text-align: left;
  white-space: nowrap;
}

.analysis-table thead th {
  background: rgba(248, 251, 255, 0.95);
  color: var(--ink-700);
  font-weight: 700;
}

.analysis-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(15, 40, 79, 0.08);
  color: var(--ink-700);
}

.analysis-tag--normal {
  background: rgba(53, 173, 116, 0.14);
  color: #1f8b5a;
}

.analysis-tag--warning {
  background: rgba(255, 189, 102, 0.2);
  color: #b96f10;
}

.analysis-tag--invalid {
  background: rgba(255, 113, 113, 0.2);
  color: #bf3434;
}

.analysis-note {
  border-radius: 12px;
  background: rgba(22, 111, 247, 0.08);
  color: #1e4d89;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.8;
}

.log-panel {
  max-height: 420px;
  overflow: auto;
  border: 1px solid rgba(148, 180, 214, 0.22);
  border-radius: 12px;
  padding: 10px 12px;
  background: #0f1d2f;
}

.log-line {
  color: #cde6ff;
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
  border-bottom: 1px dashed rgba(121, 215, 255, 0.12);
  padding: 6px 0;
}

.log-line:last-child {
  border-bottom: none;
}

.empty-state {
  color: var(--ink-500);
  font-size: 13px;
  line-height: 1.8;
}

@media (max-width: 900px) {
  .verify-form-grid,
  .preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
