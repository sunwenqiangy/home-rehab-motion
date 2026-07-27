<template>
  <div class="admin-page gold-template-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Gold Template Studio</div>
          <h1 class="page-hero__title">金标准提取与版本管理</h1>
          <p class="page-hero__subtitle">
            支持上传新视频并自动分析，或从历史已完成视频提模。生成后可保存版本并切换启停状态。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">流程：上传分析 / 选历史视频 → 提模预览 → 保存版本</span>
            <span class="page-pill">支持动作：缩腹 / 骨盆倾斜 / 膝关节旋转</span>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">当前动作启用版本</div>
            <div class="hero-glass-card__value">{{ activeVersionLabel }}</div>
            <div class="hero-glass-card__hint">共 {{ versionRows.length }} 条版本记录</div>
          </div>
        </div>
      </div>
    </section>

    <div class="operation-feedback" :class="`operation-feedback--${operationState.kind}`" role="status">
      <span class="operation-feedback__dot"></span>
      <div><strong>{{ operationState.title }}</strong><span>{{ operationState.detail }}</span></div>
      <el-button v-if="operationState.retry" size="small" link @click="operationState.retry">重试</el-button>
    </div>

    <section class="summary-grid">
      <article class="summary-card">
        <div class="summary-card__label">候选视频数</div>
        <div class="summary-card__value summary-card__value--sm">{{ sourceVideos.length }}</div>
        <div class="summary-card__foot">
          <span>仅展示已完成分析视频</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">启用版本数</div>
        <div class="summary-card__value summary-card__value--sm">{{ activeVersionCount }}</div>
        <div class="summary-card__foot">
          <span>每个动作最多保留一个启用版本</span>
        </div>
      </article>
      <article class="summary-card">
        <div class="summary-card__label">最近提模时间</div>
        <div class="summary-card__value summary-card__value--sm">{{ latestGeneratedAtLabel }}</div>
        <div class="summary-card__foot">
          <span>来自本页预览结果</span>
        </div>
      </article>
    </section>

    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">提模工作台</div>
            <div class="section-header__subtitle">可直接上传新视频完成分析，或选择历史视频生成提模预览。</div>
          </div>
          <el-button type="primary" :loading="loadingSources" @click="reloadSources">刷新候选视频</el-button>
        </div>
      </template>

      <div class="studio-grid">
        <!-- 左列：配置与操作 -->
          <div class="studio-col studio-col--source">
            <div class="studio-section-label"><span>01</span><div><strong>选择提模来源</strong><small>上传新视频或从已完成分析的历史视频中选择。</small></div></div>
            <!-- 上传新视频面板 -->

          <div class="upload-panel">
            <label class="studio-label">上传新视频（自动分析并提模）</label>
            <input class="upload-input" type="file" accept="video/*" @change="onUploadFileChange" />
            <div class="studio-meta" v-if="uploadFileName">
              <div>文件：{{ uploadFileName }}（{{ uploadFileSizeLabel || '-' }}）</div>
              <div>时长：{{ uploadFileDurationSeconds ? `${uploadFileDurationSeconds} 秒` : '-' }}</div>
            </div>
            <video
              v-if="localUploadPreviewUrl"
              class="upload-preview"
              :src="localUploadPreviewUrl"
              controls
              playsinline
              preload="metadata"
            />

            <div class="toolbar-group">
              <el-button
                type="primary"
                :loading="uploadingAndAnalyzing"
                :disabled="!uploadFile"
                @click="handleUploadAnalyzeGenerate"
              >
                {{ uploadingAndAnalyzing ? '正在上传、分析并生成…' : '上传、分析并生成预览' }}
              </el-button>
            </div>
            <div class="pipeline-text" v-if="uploadProgressText">
              {{ uploadProgressText }}
              <span v-if="uploadPollCount > 0">（轮询 {{ uploadPollCount }}）</span>
            </div>
          </div>

          <div class="split-line"></div>

          <label class="studio-label">动作类型</label>
          <el-select v-model="selectedActionType" class="studio-input" @change="handleActionChange">
            <el-option v-for="item in actionOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>

          <label class="studio-label">历史候选视频（已完成分析）</label>
          <el-select
            v-model="selectedVideoId"
            class="studio-input"
            filterable
            placeholder="请选择视频"
            :loading="loadingSources"
            @change="handleVideoChange"
          >
            <el-option
              v-for="item in sourceVideoOptions"
              :key="item.videoId"
              :label="formatVideoOption(item)"
              :value="item.videoId"
            />
          </el-select>

          <div class="studio-meta" v-if="selectedVideoInfo">
            <div>评分：{{ selectedVideoInfo.averageScore ?? '-' }}（{{ selectedVideoInfo.grade ?? '-' }}）</div>
            <div>时长：{{ selectedVideoInfo.duration ?? '-' }} 秒</div>
            <div>上传时间：{{ formatDateTime(selectedVideoInfo.uploadedAt) }}</div>
          </div>

          <div class="studio-row">
            <div class="studio-cell">
              <label class="studio-label">采样帧率</label>
              <el-input-number v-model="sampleFps" :min="5" :max="30" :step="1" class="studio-input" />
              <div class="param-hint">
                影响关键点抽样密度与切分精细度。越大越细，但对抖动更敏感、计算更重。
              </div>
            </div>
            <div class="studio-cell">
              <label class="studio-label">σ 倍数</label>
              <el-input-number v-model="sigmaMultiplier" :min="1" :max="4" :step="0.1" class="studio-input" />
              <div class="param-hint">
                控制阈值宽松度。越小越严格（更易 warning/invalid），越大越宽松。
              </div>
            </div>
          </div>

          <label class="studio-label">参数预设</label>
          <div class="param-presets">
            <el-button
              size="small"
              :type="selectedPresetKey === 'steady' ? 'primary' : 'default'"
              @click="applyParamPreset('steady')"
            >
              稳妥（10 / 2.0）
            </el-button>
            <el-button
              size="small"
              :type="selectedPresetKey === 'balanced' ? 'primary' : 'default'"
              @click="applyParamPreset('balanced')"
            >
              平衡（15 / 1.8）
            </el-button>
            <el-button
              size="small"
              :type="selectedPresetKey === 'strict' ? 'primary' : 'default'"
              @click="applyParamPreset('strict')"
            >
              严格（20 / 1.5）
            </el-button>
          </div>
          <div class="param-hint">当前档位：{{ activePresetLabel }}。预设仅影响本次分析与提模，不会改历史版本。</div>

          <label class="studio-label">提模备注</label>
          <el-input v-model="generationNotes" type="textarea" :rows="3" placeholder="可填写提模背景、拍摄条件等" />

          <div class="toolbar-group">
            <el-button type="primary" :loading="generating" :disabled="!selectedVideoId" @click="handleGenerate">
              {{ generating ? '正在生成预览…' : '仅生成提模预览' }}
            </el-button>
            <el-button :disabled="!generatedResult || generating" @click="clearGenerated">清空预览</el-button>
          </div>
        </div>

        <!-- 右列：预览与保存 -->
          <div class="studio-col studio-col--preview">
            <div class="studio-section-label"><span>02</span><div><strong>核对预览并保存</strong><small>确认质量与区间后，保存为独立版本。</small></div></div>
            <div class="preview-header">

            <div class="preview-title">提模预览</div>
            <el-tag
              v-if="generatedResult"
              :type="generatedResult.qualityReport.qualityPass ? 'success' : 'warning'"
              size="small"
            >
              {{ generatedResult.qualityReport.qualityPass ? '质量通过' : '质量待复核' }}
            </el-tag>
          </div>

          <div v-if="generatedResult" class="preview-body">
            <div class="preview-metrics">
              <div class="preview-item">
                <span>有效周期</span>
                <b>{{ generatedResult.qualityReport.validCycles ?? '-' }}</b>
              </div>
              <div class="preview-item">
                <span>总周期</span>
                <b>{{ generatedResult.qualityReport.totalCycles ?? '-' }}</b>
              </div>
              <div class="preview-item">
                <span>无效周期</span>
                <b>{{ generatedResult.qualityReport.invalidCycles ?? '-' }}</b>
              </div>
              <div class="preview-item">
                <span>周期来源</span>
                <b>{{ validCycleSourceLabel }}</b>
              </div>
              <div class="preview-item">
                <span>本次采样帧率</span>
                <b>{{ sampleFps }}</b>
              </div>
              <div class="preview-item">
                <span>本次 σ 倍数</span>
                <b>{{ sigmaMultiplier }}</b>
              </div>
              <div class="preview-item">
                <span>参数档位</span>
                <b>{{ activePresetLabel }}</b>
              </div>
              <div class="preview-item">
                <span>平均置信度</span>
                <b>{{ generatedResult.qualityReport.avgConfidence ?? '-' }}</b>
              </div>
              <div class="preview-item preview-item--full">
                <span>生成时间</span>
                <b>{{ formatDateTime(generatedResult.generatedAt) }}</b>
              </div>
            </div>
            <div class="preview-note" v-if="generatedResult.qualityReport.totalCycles != null">
              说明：有效周期来自「{{ validCycleSourceLabel }}」。
              当有效周期偏低（例如 1）时，通常表示当前视频中大部分周期被判定为 invalid（代偿或阈值超界），
              建议先在流程验证页查看每个 rep 的 validFlag 与 compareLabel 明细。
            </div>

            <div class="preview-subtitle">参考统计数据（节选）</div>
            <pre class="compact-code">{{ JSON.stringify(generatedResult.referenceStats, null, 2) }}</pre>

            <div class="preview-subtitle">阈值配置（节选）</div>
            <pre class="compact-code">{{ JSON.stringify(generatedResult.thresholdConfig, null, 2) }}</pre>

            <div class="preview-subtitle" v-if="generatedResult.compareSummary">与当前启用版本对比</div>
            <pre v-if="generatedResult.compareSummary" class="compact-code">{{
              JSON.stringify(generatedResult.compareSummary, null, 2)
            }}</pre>

            <div class="preview-subtitle">保存为新版本</div>
            <div class="studio-row">
              <div class="studio-cell">
                <label class="studio-label">版本号</label>
                <el-input v-model="newVersion" placeholder="例如 v2026.07.21-a" />
              </div>
              <div class="studio-cell">
                <label class="studio-label">版本描述</label>
                <el-input v-model="newDescription" placeholder="描述本次提模来源与变更点" />
              </div>
            </div>
            <div class="toolbar-group">
              <el-button type="success" :loading="saving" @click="handleSaveVersion">{{ saving ? '正在保存版本…' : '保存新版本' }}</el-button>
            </div>
          </div>
          <div v-else class="empty-state">请选择视频并生成提模预览。</div>
        </div>
      </div>
    </el-card>

    <!-- 版本管理 -->
    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">版本管理</div>
            <div class="section-header__subtitle">查看全部历史版本，支持启用/停用切换。</div>
          </div>
          <el-button :loading="loadingVersions" @click="reloadVersions">刷新版本</el-button>
        </div>
      </template>

      <div class="filter-shell">
        <el-select v-model="versionStatusFilter" style="width: 180px" @change="reloadVersions">
          <el-option label="全部状态" :value="-1" />
          <el-option label="已启用" :value="1" />
          <el-option label="已停用" :value="0" />
        </el-select>
      </div>

      <div class="table-shell" v-loading="loadingVersions">
        <el-table :data="versionRows" stripe>
          <el-table-column prop="actionType" label="动作" min-width="120">
            <template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template>
          </el-table-column>
          <el-table-column prop="version" label="版本" min-width="130" />
          <el-table-column prop="createdAt" label="创建时间" min-width="180">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="createdBy" label="创建人" min-width="130" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
                {{ row.status === 1 ? '启用' : '停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="说明" min-width="220">
            <template #default="{ row }">{{ row.description || '-' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 0"
                type="success"
                size="small"
                :loading="togglingVersionId === row.templateId"
                @click="handleToggleStatus(row.templateId, 1)"
              >
                {{ togglingVersionId === row.templateId ? '正在启用…' : '启用' }}
              </el-button>
              <el-button
                v-if="row.status === 1"
                type="warning"
                size="small"
                :loading="togglingVersionId === row.templateId"
                @click="handleToggleStatus(row.templateId, 0)"
              >
                {{ togglingVersionId === row.templateId ? '正在停用…' : '停用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { ElMessage } from 'element-plus';
import axios from 'axios';
import type {
  GoldTemplateGenerateResponseDto,
  GoldTemplateSourceVideoDto,
  GoldTemplateVersionDto,
PresignUploadResponseDto,
ConfirmUploadResponseDto,
  VideoStatusDto,
} from '@home-rehab-motion/shared-contract';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import {
  getGoldTemplateSourceVideos,
  generateGoldTemplate,
  saveGoldTemplate,
  getGoldTemplateVersions,
  updateGoldTemplateVersionStatus,
} from '@/services/config';

/* ========== 工具函数 ========== */

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

function unwrap<T>(payload: ApiEnvelope<T>): T {
  if (!payload?.success) {
    throw new Error(payload?.message || '请求失败');
  }
  return payload.data;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const src = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      resolve(Math.round(video.duration));
      URL.revokeObjectURL(src);
    };
    video.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(src);
    };
    video.src = src;
  });
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
  return { Authorization: `Bearer ${localStorage.getItem('admin_token') || ''}` };
}

function extractErrorMessage(err: unknown): string {
  const maybe = err as {
    response?: {
      status?: number;
      data?: { message?: string } | string;
    };
    message?: string;
  };

  const status = maybe.response?.status;
  const data = maybe.response?.data;
  const backendMessage = typeof data === 'string' ? data : data?.message;

  if (status && backendMessage) {
    return `HTTP ${status}: ${backendMessage}`;
  }
  if (status) {
    return `HTTP ${status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ========== 常量 ========== */

const actionOptions: Array<{ label: string; value: TrainingActionType }> = [
  { label: '缩腹运动', value: 'abdominal_crunch' },
  { label: '骨盆倾斜', value: 'pelvic_tilt' },
  { label: '膝关节旋转', value: 'knee_rotation' },
];

/* ========== 状态：提模配置 ========== */

const selectedActionType = ref<TrainingActionType>('abdominal_crunch');
const selectedVideoId = ref<number | null>(null);
const sampleFps = ref(10);
const sigmaMultiplier = ref(1.5);
const generationNotes = ref('');

type ParamPresetKey = 'steady' | 'balanced' | 'strict' | 'custom';
const PARAM_PRESETS = {
  steady: { sampleFps: 10, sigmaMultiplier: 2.0, label: '稳妥（10 / 2.0）' },
  balanced: { sampleFps: 15, sigmaMultiplier: 1.8, label: '平衡（15 / 1.8）' },
  strict: { sampleFps: 20, sigmaMultiplier: 1.5, label: '严格（20 / 1.5）' },
} as const;

const ACTION_DEFAULT_PRESET: Record<TrainingActionType, Exclude<ParamPresetKey, 'custom'>> = {
  abdominal_crunch: 'balanced',
  pelvic_tilt: 'steady',
  knee_rotation: 'steady',
};
const selectedPresetKey = ref<ParamPresetKey>('custom');

/* ========== 状态：上传流程 ========== */

const uploadFile = ref<File | null>(null);
const uploadFileName = ref('');
const uploadFileSizeLabel = ref('');
const uploadFileDurationSeconds = ref(0);
const localUploadPreviewUrl = ref('');
const debugCode = ref(`gold-studio-${Date.now()}`);
const uploadingAndAnalyzing = ref(false);
const uploadProgressText = ref('');
const uploadPollCount = ref(0);

/* ========== 状态：候选视频 ========== */

const sourceVideos = ref<GoldTemplateSourceVideoDto[]>([]);
const loadingSources = ref(false);

/* ========== 状态：提模预览 ========== */

const generating = ref(false);
const generatedResult = ref<GoldTemplateGenerateResponseDto | null>(null);
const newVersion = ref('');
const newDescription = ref('');
const saving = ref(false);

/* ========== 状态：版本管理 ========== */

const versionRows = ref<GoldTemplateVersionDto[]>([]);
const loadingVersions = ref(false);
const versionStatusFilter = ref(-1);
const togglingVersionId = ref<number | null>(null);
const operationState = ref<{ kind: 'idle' | 'saving' | 'success' | 'error'; title: string; detail: string; retry?: () => void }>({ kind: 'idle', title: '操作状态', detail: '尚未执行保存或版本操作。' });

function setOperationState(kind: 'saving' | 'success' | 'error', title: string, detail: string, retry?: () => void) {
  operationState.value = { kind, title, detail, retry };
}

/* ========== 计算属性 ========== */

const sourceVideoOptions = computed(() =>
  sourceVideos.value.filter((v) => v.status === 'completed'),
);

const selectedVideoInfo = computed(() =>
  sourceVideoOptions.value.find((v) => v.videoId === selectedVideoId.value) ?? null,
);

const activeVersionCount = computed(
  () => versionRows.value.filter((v) => v.status === 1).length,
);

const activeVersionLabel = computed(() => {
  const active = versionRows.value.find((v) => v.status === 1 && v.actionType === selectedActionType.value);
  return active ? `${active.version}（${actionTypeLabel(active.actionType)}）` : '暂无启用版本';
});

const latestGeneratedAtLabel = computed(() =>
  generatedResult.value ? formatDateTime(generatedResult.value.generatedAt) : '-',
);

const validCycleSourceLabel = computed(() => {
  const source = generatedResult.value?.qualityReport?.validCycleSource;
  if (source === 'rep_evaluation_results') return '评分结果表（rep_evaluation_results）';
  if (source === 'video_evaluation_result') return '视频汇总表（video_evaluation_result）';
  if (source === 'motion_feature_results') return '特征明细推断（motion_feature_results）';
  return '-';
});

const activePresetLabel = computed(() => {
  if (selectedPresetKey.value === 'custom') {
    return `自定义（${sampleFps.value} / ${sigmaMultiplier.value}）`;
  }
  return PARAM_PRESETS[selectedPresetKey.value].label;
});

/* ========== 方法：动作类型 ========== */

function actionTypeLabel(type: TrainingActionType): string {
  return actionOptions.find((item) => item.value === type)?.label || type;
}

function applyParamPreset(key: Exclude<ParamPresetKey, 'custom'>) {
  const preset = PARAM_PRESETS[key];
  sampleFps.value = preset.sampleFps;
  sigmaMultiplier.value = preset.sigmaMultiplier;
  selectedPresetKey.value = key;
}

watch([sampleFps, sigmaMultiplier], ([fps, sigma]) => {
  const hit = (Object.entries(PARAM_PRESETS).find(
    ([, preset]) => preset.sampleFps === fps && preset.sigmaMultiplier === sigma,
  )?.[0] || 'custom') as ParamPresetKey;
  selectedPresetKey.value = hit;
}, { immediate: true });

function handleActionChange() {
  selectedVideoId.value = null;
  generatedResult.value = null;
  applyParamPreset(ACTION_DEFAULT_PRESET[selectedActionType.value]);
  loadSourceVideos();
}

/* ========== 方法：视频选择 ========== */

function formatVideoOption(item: GoldTemplateSourceVideoDto): string {
  const label = actionTypeLabel(item.actionType as TrainingActionType);
  const score = item.averageScore != null ? ` 评分${item.averageScore}` : '';
  const dur = item.duration ? ` ${item.duration}s` : '';
  return `#${item.videoId} ${label}${score}${dur}`;
}

function handleVideoChange() {
  generatedResult.value = null;
}

/* ========== 方法：上传文件选择 ========== */

async function onUploadFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (localUploadPreviewUrl.value) {
    URL.revokeObjectURL(localUploadPreviewUrl.value);
    localUploadPreviewUrl.value = '';
  }
  if (!file) {
    uploadFile.value = null;
    uploadFileName.value = '';
    uploadFileSizeLabel.value = '';
    uploadFileDurationSeconds.value = 0;
    return;
  }
  uploadFile.value = file;
  uploadFileName.value = file.name;
  uploadFileSizeLabel.value = formatSize(file.size);
  localUploadPreviewUrl.value = URL.createObjectURL(file);
  uploadFileDurationSeconds.value = await getVideoDuration(file);
}

/* ========== 方法：上传+分析+提模 闭环 ========== */

let uploadPollTimer: ReturnType<typeof setTimeout> | null = null;

async function handleUploadAnalyzeGenerate() {
  if (!uploadFile.value) {
    ElMessage.warning('请先选择视频文件');
    return;
  }

  uploadingAndAnalyzing.value = true;
  setOperationState('saving', '正在处理上传视频', '正在执行上传、分析和提模预览，请勿关闭当前页面。', () => void handleUploadAnalyzeGenerate());
  uploadProgressText.value = '';
  uploadPollCount.value = 0;
  generatedResult.value = null;

  try {
    /* 1. 以管理员身份创建金标准内部样本 */
    uploadProgressText.value = '步骤 1/4：创建金标准内部样本...';
    const presignRes = await axios.get<ApiEnvelope<PresignUploadResponseDto>>(
      '/api/videos/admin/internal-samples/gold_template/presign-upload',
      { headers: adminAuthHeaders() },
    );
    const presign = unwrap(presignRes.data);
    const videoId = presign.videoId;

    /* 3. 上传视频文件 */
    uploadProgressText.value = `步骤 3/4：上传视频（videoId=${videoId}）...`;
    const uploadUrl = normalizeUploadUrl(presign.uploadUrl);

    if (presign.uploadType === 's3_post' && presign.uploadFields) {
      const formData = new FormData();
      for (const [key, val] of Object.entries(presign.uploadFields)) {
        formData.append(key, val);
      }
      formData.append('file', uploadFile.value);
      await axios.post(uploadUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } else {
      // main-service /videos/:videoId/upload 走 FileInterceptor，需要 multipart + file 字段
      const formData = new FormData();
      formData.append('file', uploadFile.value, uploadFile.value.name);
      await axios.post(uploadUrl, formData, {
        headers: { ...adminAuthHeaders(), 'Content-Type': 'multipart/form-data' },
      });
    }

    /* 4. 确认上传，触发分析 */
    uploadProgressText.value = '步骤 4/4：确认上传并触发分析...';
    const confirmRes = await axios.post<ApiEnvelope<ConfirmUploadResponseDto>>(
      `/api/videos/admin/internal-samples/${videoId}/confirm-upload`,
      {
        videoId,
        actionType: selectedActionType.value,
        duration: uploadFileDurationSeconds.value || 30,
        sampleFps: sampleFps.value,
        sigmaMultiplier: sigmaMultiplier.value,
      },
      { headers: adminAuthHeaders() },
    );
    const confirmData = unwrap(confirmRes.data);

    /* 5. 轮询分析状态 */
    if (confirmData.status === 'completed') {
      uploadProgressText.value = '分析已完成（同步模式）';
    } else {
      uploadProgressText.value = '分析已排队，等待完成...';
      await pollVideoStatus(videoId);
    }

    /* 6. 自动选中新视频并生成提模 */
    uploadProgressText.value = '分析完成，正在生成提模预览...';
    selectedVideoId.value = videoId;
    await reloadSources();
    await doGenerate(videoId);

    uploadProgressText.value = '全部完成';
    setOperationState('success', '上传、分析与提模预览已完成', '已生成提模预览，请核对结果后填写版本信息并保存。');
    ElMessage.success('上传、分析、提模预览已全部完成');
  } catch (err: unknown) {
    const msg = extractErrorMessage(err);
    uploadProgressText.value = `流程中断：${msg}`;
    setOperationState('error', '上传或分析未完成', msg, () => void handleUploadAnalyzeGenerate());
    ElMessage.error(msg);
  } finally {
    uploadingAndAnalyzing.value = false;
  }
}

async function pollVideoStatus(videoId: number): Promise<void> {
  const MAX_POLL = 60;
  const INTERVAL_MS = 3_000;

  for (let i = 1; i <= MAX_POLL; i++) {
    uploadPollCount.value = i;
    await new Promise((r) => {
      uploadPollTimer = setTimeout(r, INTERVAL_MS);
    });

    try {
      const res = await axios.get<ApiEnvelope<VideoStatusDto>>(
        `/api/videos/admin/internal-samples/${videoId}/status`,
        { headers: adminAuthHeaders() },
      );
      const status = unwrap(res.data);

      if (status.status === 'completed') {
        uploadProgressText.value = '分析已完成';
        return;
      }
      if (status.status === 'failed' || status.status === 'quality_insufficient') {
        throw new Error(`分析失败：${status.failReason || status.status}`);
      }
      uploadProgressText.value = `分析中... 状态=${status.status}`;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('分析失败')) throw err;
      // 网络异常可重试
    }
  }
  throw new Error('分析超时，请稍后在版本管理中手动提模');
}

/* ========== 方法：提模预览 ========== */

async function handleGenerate() {
  if (!selectedVideoId.value) {
    ElMessage.warning('请先选择视频');
    return;
  }
  await doGenerate(selectedVideoId.value);
}

async function doGenerate(videoId: number) {
  generating.value = true;
  setOperationState('saving', '正在生成提模预览', '正在根据当前视频和参数生成金标准候选结果。', () => void doGenerate(videoId));
  try {
    const payload = {
      actionType: selectedActionType.value,
      sourceVideoId: videoId,
      sampleFps: sampleFps.value,
      sigmaMultiplier: sigmaMultiplier.value,
      notes: generationNotes.value || undefined,
    };
    generatedResult.value = await generateGoldTemplate(payload);

    // 自动填充版本号
    setOperationState('success', '提模预览已生成', '请检查质量、特征区间和版本说明，再保存为新版本。');
    if (!newVersion.value) {
      const date = new Date();
      const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
      newVersion.value = `v${dateStr}-a`;
    }
  } catch (err: unknown) {
    const msg = extractErrorMessage(err);
    setOperationState('error', '提模预览生成失败', msg, () => void doGenerate(videoId));
    ElMessage.error(`提模失败：${msg}`);
  } finally {
    generating.value = false;
  }
}

function clearGenerated() {
  generatedResult.value = null;
  newVersion.value = '';
  newDescription.value = '';
}

/* ========== 方法：保存版本 ========== */

async function handleSaveVersion() {
  if (!generatedResult.value) {
    ElMessage.warning('请先生成提模预览');
    return;
  }
  if (!newVersion.value.trim()) {
    ElMessage.warning('请输入版本号');
    return;
  }

  saving.value = true;
  setOperationState('saving', '正在保存新版本', `正在保存版本 ${newVersion.value.trim()}，保存成功后会同步刷新版本列表。`, () => void handleSaveVersion());
  try {
    await saveGoldTemplate({
      actionType: selectedActionType.value,
      version: newVersion.value.trim(),
      description: newDescription.value.trim() || undefined,
      referenceStats: generatedResult.value.referenceStats,
      thresholdConfig: generatedResult.value.thresholdConfig,
    });
    setOperationState('success', '新版本已保存', `版本 ${newVersion.value.trim()} 已加入版本列表，可按需要启用。`);
    ElMessage.success('版本保存成功');
    clearGenerated();
    await reloadVersions();
  } catch (err: unknown) {
    const msg = extractErrorMessage(err);
    setOperationState('error', '新版本保存失败', msg, () => void handleSaveVersion());
    ElMessage.error(`保存失败：${msg}`);
  } finally {
    saving.value = false;
  }
}

/* ========== 方法：版本管理 ========== */

async function handleToggleStatus(templateId: number, newStatus: number) {
  togglingVersionId.value = templateId;
  setOperationState('saving', newStatus === 1 ? '正在启用版本' : '正在停用版本', '正在更新版本状态，完成后列表将自动刷新。', () => void handleToggleStatus(templateId, newStatus));
  try {
    await updateGoldTemplateVersionStatus(templateId, { status: newStatus });
    setOperationState('success', newStatus === 1 ? '版本已启用' : '版本已停用', '版本状态已更新，当前列表已刷新。');
    ElMessage.success(newStatus === 1 ? '已启用' : '已停用');
    await reloadVersions();
  } catch (err: unknown) {
    const msg = extractErrorMessage(err);
    setOperationState('error', '版本状态更新失败', msg, () => void handleToggleStatus(templateId, newStatus));
    ElMessage.error(`操作失败：${msg}`);
  } finally {
    togglingVersionId.value = null;
  }
}

/* ========== 数据加载 ========== */

async function loadSourceVideos() {
  loadingSources.value = true;
  try {
    const res = await getGoldTemplateSourceVideos(selectedActionType.value);
    sourceVideos.value = res.items ?? [];
  } catch {
    sourceVideos.value = [];
  } finally {
    loadingSources.value = false;
  }
}

async function reloadSources() {
  await loadSourceVideos();
}

async function loadVersions() {
  loadingVersions.value = true;
  try {
    const params: { status?: number; limit?: number } = {};
    if (versionStatusFilter.value >= 0) params.status = versionStatusFilter.value;
    params.limit = 50;
    const res = await getGoldTemplateVersions(params);
    versionRows.value = res.items ?? [];
  } catch {
    versionRows.value = [];
  } finally {
    loadingVersions.value = false;
  }
}

async function reloadVersions() {
  await loadVersions();
}

/* ========== 生命周期 ========== */

onMounted(() => {
  applyParamPreset(ACTION_DEFAULT_PRESET[selectedActionType.value]);
  loadSourceVideos();
  loadVersions();
});

onBeforeUnmount(() => {
  if (uploadPollTimer) {
    clearTimeout(uploadPollTimer);
    uploadPollTimer = null;
  }
  if (localUploadPreviewUrl.value) {
    URL.revokeObjectURL(localUploadPreviewUrl.value);
  }
});
</script>

<style scoped>
.gold-template-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 48px;
}

.operation-feedback { display: flex; align-items: center; gap: 12px; min-height: 58px; padding: 12px 16px; border: 1px solid var(--line-soft); border-radius: var(--radius-md); background: var(--surface-strong); box-shadow: var(--shadow-soft); }
.operation-feedback__dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: var(--ink-500); }.operation-feedback > div { display: grid; gap: 3px; flex: 1; min-width: 0; }.operation-feedback strong { color: var(--ink-900); font-size: 13px; }.operation-feedback span { overflow: hidden; color: var(--ink-500); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.operation-feedback--saving { border-color: rgba(79,195,247,.35); background: rgba(79,195,247,.10); }.operation-feedback--saving .operation-feedback__dot { background: var(--brand-500); animation: feedback-pulse 1.2s infinite; }.operation-feedback--success { border-color: rgba(51,178,123,.3); background: rgba(51,178,123,.09); }.operation-feedback--success .operation-feedback__dot { background: var(--success); }.operation-feedback--error { border-color: rgba(239,106,106,.32); background: rgba(239,106,106,.09); }.operation-feedback--error .operation-feedback__dot { background: var(--danger); }@keyframes feedback-pulse { 50% { opacity: .35; transform: scale(1.55); } }
/* Hero、摘要卡和容器复用系统全局设计令牌，避免本页出现独立的亮青色主题。 */

/* ---- Summary ---- */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.summary-card { background: var(--surface-strong); border: 1px solid var(--line-soft); border-radius: var(--radius-md); padding: 20px 24px; box-shadow: var(--shadow-soft); }
.summary-card__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.summary-card__value { font-size: 24px; font-weight: 700; color: var(--brand-700); }
.summary-card__value--sm {
  font-size: 20px;
}
.summary-card__foot {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 8px;
}

/* ---- Surface card ---- */
.surface-card { border-radius: var(--radius-lg); border: 1px solid var(--line-soft); }
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.section-header__title {
  font-size: 16px;
  font-weight: 600;
}
.section-header__subtitle {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

/* ---- Studio grid ---- */
.studio-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}
@media (max-width: 960px) {
  .studio-grid {
    grid-template-columns: 1fr;
  }
}
.studio-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 20px; border: 1px solid var(--line-soft); border-radius: var(--radius-md); background: var(--surface-strong); box-shadow: 0 10px 26px rgba(15,40,79,.05); }.studio-col--source, .studio-col--preview { background: var(--surface-strong); }.studio-section-label { display: flex; gap: 10px; align-items: center; padding: 0 0 14px; border-bottom: 1px solid var(--line-soft); }.studio-section-label > span { display:grid; width: 30px; height: 30px; flex:0 0 auto; place-items:center; border-radius:10px; color:var(--brand-700); background:rgba(79,195,247,.16); font-size:11px; font-weight:800; }.studio-section-label div { display:grid; gap:2px; }.studio-section-label strong { color:var(--ink-900); font-size:14px; }.studio-section-label small { color:var(--ink-500); font-size:11px; }

/* ---- Upload panel ---- */
.upload-panel {
  background: var(--el-fill-color-light);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.upload-input {
  font-size: 14px;
}
.upload-preview {
  width: 100%;
  max-height: 200px;
  border-radius: 8px;
  background: #000;
}
.pipeline-text {
  font-size: 13px;
  color: var(--el-color-primary);
  line-height: 1.5;
}
.split-line {
  height: 1px;
  background: var(--el-border-color-lighter);
  margin: 4px 0;
}

/* ---- Form ---- */
.studio-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  margin-bottom: 4px;
}
.studio-input {
  width: 100%;
}
.studio-row {
  display: flex;
  gap: 14px;
}
.studio-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.studio-meta {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.param-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
}
.param-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.toolbar-group {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

/* ---- Preview ---- */
.preview-header { padding: 2px 0 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.preview-title {
  font-size: 16px;
  font-weight: 600;
}
.preview-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.preview-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.preview-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}
.preview-item--full {
  grid-column: 1 / -1;
}
.preview-item span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.preview-item b {
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 1.4;
}
.preview-subtitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  margin-top: 6px;
}
.compact-code {
  background: var(--brand-950);
  color: var(--brand-300);
  border: 1px solid rgba(121,215,255,.20);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.preview-note {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-700);
  background: var(--el-fill-color-light);
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  padding: 10px 12px;
}
.empty-state { min-height: 260px; background: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  color: var(--el-text-color-placeholder);
  font-size: 14px;
  border: 1px dashed var(--el-border-color);
  border-radius: 10px;
}

/* ---- Version table ---- */
.filter-shell {
  margin-bottom: 16px;
}
.table-shell {
  min-height: 120px;
}

@media (max-width: 760px) {
  .preview-metrics {
    grid-template-columns: 1fr;
  }
  .preview-item--full {
    grid-column: auto;
  }
}
</style>
