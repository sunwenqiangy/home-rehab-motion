<template>
  <div class="admin-page threshold-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Template Thresholds</div>
          <h1 class="page-hero__title">阈值参数管理</h1>
          <p class="page-hero__subtitle">
通过 σ 倍数统一控制评分门限，再按每个动作特征配置“有效区间”和“警告区间”，用于识别动作偏差与风险提示。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">共 {{ thresholds.length }} 条配置</span>
          </div>
        </div>
        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">当前模板数</div>
            <div class="hero-glass-card__value">{{ thresholds.length }}</div>
            <div class="hero-glass-card__hint">按动作类型与版本区分</div>
          </div>
        </div>
      </div>
    </section>

    <!-- 列表区域 -->
    <el-card class="surface-card" shadow="never">
      <template #header>
        <div class="section-header">
          <div>
            <div class="section-header__title">阈值配置列表</div>
            <div class="section-header__subtitle">优先使用“调优”修改门限和区间；“高级配置”仅用于需要直接维护原始参数的场景。</div>
          </div>
          <el-button type="primary" @click="loadData" :loading="loading">刷新</el-button>
        </div>
      </template>

      <div class="threshold-guide" role="note">
        <span class="threshold-guide__mark">i</span>
        <div><strong>如何理解这些参数？</strong><span> σ 倍数越小，判定越严格；有效区间代表动作表现正常的范围，警告区间代表需要关注但不一定判定异常的范围。</span></div>
      </div>

      <div class="table-shell" v-loading="loading">
        <el-table :data="thresholds" stripe style="width: 100%">
          <el-table-column prop="actionType" label="动作类型" min-width="130">
            <template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template>
          </el-table-column>
          <el-table-column prop="version" label="模板版本" width="160" />
          <el-table-column label="门限（σ）" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="sigmaTagType(row)">{{ extractSigma(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="配置特征" width="92" align="center">
            <template #default="{ row }">{{ featureKeys(row).length }}</template>
          </el-table-column>
          <el-table-column label="核心特征" min-width="280">
            <template #default="{ row }">
              <div class="feature-chips">
                <span
                  v-for="key in featureKeys(row)"
                  :key="key"
                  class="feature-chip"
                  :class="{ 'feature-chip--warn': isFeatureOverTight(row, key) }"
                >
                  {{ featureShortLabel(key) }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" fixed="right" align="center">
            <template #default="{ row }">
              <el-button type="primary" link @click="openTune(row)">调优</el-button>
              <el-button link @click="openJsonEdit(row)">高级配置</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 核心参数调优弹窗 -->
    <el-dialog v-model="tuneDialogVisible" title="核心参数调优" width="820px" class="tune-dialog" modal-class="tune-dialog-overlay" :close-on-click-modal="false">
      <div class="tune-dialog__body">
      <!-- 顶部信息条 -->
      <div class="tune-header">
        <div class="tune-meta">
          <div class="tune-header__item">
            <span class="tune-header__label">动作类型</span>
            <span class="tune-header__value">{{ actionTypeLabel(tuningItem?.actionType) }}</span>
          </div>
          <div class="tune-header__item">
            <span class="tune-header__label">版本</span>
            <span class="tune-header__value">{{ tuningItem?.version }}</span>
          </div>
        </div>
      </div>

      <!-- 宽松度选择（合并 σ + 档位） -->
      <div class="preset-bar">
        <div class="preset-bar__top">
          <span class="preset-bar__title">评分门限（允许偶差多少倍特征标准差）</span>
          <span class="preset-bar__sigma">当前门限倍数 = <b>{{ tuneSigma }}</b></span>
        </div>
        <div class="preset-cards">
          <button
            v-for="p in PRESET_CONFIGS"
            :key="p.key"
            class="preset-card"
            :class="{ 'preset-card--active': presetMode === p.key }"
            @click="handlePresetChange(p.key)"
          >
            <span class="preset-card__name">{{ p.name }}</span>
            <span class="preset-card__sigma">门限倍数 ×{{ p.sigma }}</span>
            <span class="preset-card__desc">{{ p.desc }}</span>
          </button>
        </div>
        <div class="preset-bar__range-row">
          <span class="preset-bar__range-label">区间宽度：</span>
          <div class="preset-bar__range-inputs">
            <span class="preset-bar__range-tag">有效</span>
            <span class="preset-bar__range-eq">均值 ±</span>
            <div class="range-mult-input">
              <button class="range-mult-btn" @click="rangeValidMult = Math.max(0.5, +((rangeValidMult - 0.5).toFixed(1)))">-</button>
              <span class="range-mult-val">{{ rangeValidMult }}</span>
              <button class="range-mult-btn" @click="rangeValidMult = Math.min(5, +((rangeValidMult + 0.5).toFixed(1)))">+</button>
            </div>
            <span class="preset-bar__range-tag">×标准差</span>
            <span class="range-mult-sep">|</span>
            <span class="preset-bar__range-tag">警告</span>
            <span class="preset-bar__range-eq">均值 ±</span>
            <div class="range-mult-input">
              <button class="range-mult-btn" @click="rangeWarnMult = Math.max(0.5, +((rangeWarnMult - 0.5).toFixed(1)))">-</button>
              <span class="range-mult-val">{{ rangeWarnMult }}</span>
              <button class="range-mult-btn" @click="rangeWarnMult = Math.min(6, +((rangeWarnMult + 0.5).toFixed(1)))">+</button>
            </div>
            <span class="preset-bar__range-tag">×标准差</span>
            <el-button size="small" type="primary" plain @click="recomputeRanges">重算区间</el-button>
          </div>
        </div>
        <div v-if="actionStatus" class="preset-bar__status">{{ actionStatus }}</div>
      </div>

      <!-- 特征区间列表 -->
      <div class="features-section">
        <div class="features-section__head">
          <span class="features-section__title">各特征区间</span>
          <div v-if="hasCoreFilter" class="feat-tab-group">
            <button
              class="feat-tab"
              :class="{ 'feat-tab--active': !showAllFeatures }"
              @click="showAllFeatures = false"
            >核心特征</button>
            <button
              class="feat-tab"
              :class="{ 'feat-tab--active': showAllFeatures }"
              @click="showAllFeatures = true"
            >全部特征 <span class="feat-tab__count">{{ tuneFeatures.length }}</span></button>
          </div>
        </div>

        <div v-for="feat in displayedTuneFeatures" :key="feat.code" class="feat-row">
          <!-- 左：特征信息 -->
          <div class="feat-info">
            <div class="feat-name">
              {{ featureLabel(feat.code) }}
              <el-tag v-if="feat.unit" size="small" type="info">{{ feat.unit }}</el-tag>
              <el-tag v-if="feat.direction" size="small" :type="dirTagType(feat.direction)">
                {{ dirLabel(feat.direction) }}
              </el-tag>
            </div>
            <div class="feat-code">{{ feat.code }}</div>
            <div class="feat-desc" v-if="featureDesc(feat.code)">{{ featureDesc(feat.code) }}</div>
            <div class="feat-ref" v-if="feat.goldMean != null">
              均值 {{ feat.goldMean }} / 标准差 {{ feat.goldStd }}
              <span v-if="feat.goldStd" class="feat-ref-calc">
                → 2×标准差上限 ≈ {{ calcUpperBound(feat, 2) }}
              </span>
            </div>
          </div>
          <!-- 右：有效 / 警告区间（标题+输入对齐） -->
          <div class="feat-ranges">
            <div class="range-row">
              <span class="range-label range-label--valid">有效</span>
              <div class="range-pair">
                <el-input-number v-model="feat.validLo" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" />
                <span class="range-sep">~</span>
                <el-input-number v-model="feat.validHi" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" />
              </div>
            </div>
            <div class="range-row">
              <span class="range-label range-label--warn">警告</span>
              <div class="range-pair">
                <el-input-number v-model="feat.warnLo" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" />
                <span class="range-sep">~</span>
                <el-input-number v-model="feat.warnHi" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" />
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <template #footer>
        <el-button @click="tuneDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleTuneSave" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <!-- JSON 编辑弹窗（高级） -->
    <el-dialog v-model="jsonDialogVisible" title="高级配置编辑" width="640px">
      <div class="json-edit-warn">
        直接编辑原始 JSON 可能破坏配置结构；如只需调整门限或区间，请优先使用“调优”。
      </div>
      <el-form label-position="top">
        <el-form-item label="动作类型">
          <el-input :model-value="actionTypeLabel(jsonEditingItem?.actionType)" disabled />
        </el-form-item>
        <el-form-item label="当前版本">
          <el-input :model-value="jsonEditingItem?.version" disabled />
        </el-form-item>
        <el-form-item label="阈值配置">
          <el-input v-model="jsonEditConfigStr" type="textarea" :rows="14" placeholder="请输入 JSON 格式配置" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="jsonDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleJsonSave" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getThresholds, updateThreshold } from '@/services/config';
import type { ThresholdConfigDto } from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';

/* ============================================================ */
/*  数据加载                                                      */
/* ============================================================ */

const thresholds = ref<ThresholdConfigDto[]>([]);
const loading = ref(false);
const saving = ref(false);

async function loadData() {
  loading.value = true;
  try {
    thresholds.value = await getThresholds();
  } catch (error: any) {
    thresholds.value = [];
    ElMessage.error(error?.response?.data?.message || '加载阈值配置失败');
  } finally {
    loading.value = false;
  }
}

/* ============================================================ */
/*  辅助函数                                                      */
/* ============================================================ */

function actionTypeLabel(type?: TrainingActionType): string {
  if (!type) return '-';
  const map: Record<string, string> = {
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
  };
  return map[type] || type;
}

// 特征完整信息：中文名 + 说明
const FEATURE_META: Record<string, { label: string; desc: string }> = {
  trunk_angle_change:      { label: '躯干角度变化', desc: '运动过程中躯干的角度偏转幅度，反映核心稳定性' },
  abdominal_displacement:  { label: '腹部位移',     desc: '腹部在运动中的相对位移量，核心收缩指标' },
  pelvis_shift:            { label: '骨盆偏移',     desc: '骨盆在水平方向的偏移幅度，偏移越小越稳定' },
  pelvic_tilt_delta:       { label: '骨盆倾斜幅度', desc: '骨盆前倾/后倾的角度变化量，核心动作主指标' },
  pelvic_tilt_velocity:    { label: '骨盆倾斜速度', desc: '骨盆倾斜动作的执行速度，反映动作节奏控制' },
  hold_duration:           { label: '保持时长',     desc: '在目标姿态上维持的时间，反映肌肉耐力' },
  knee_rotation_range:     { label: '膝关节旋转幅度', desc: '膝关节旋转的角度范围，核心动作主指标' },
  knee_rotation_velocity:  { label: '膝关节旋转速度', desc: '旋转动作的执行速度，反映动作节奏控制' },
  knee_rotation_angle:     { label: '膝关节旋转角',  desc: '膝关节当前旋转角度绝对值' },
  knee_symmetry:           { label: '膝关节对称性',  desc: '左右膝关节旋转幅度的对称程度，值越高越对称' },
  rotation_velocity:       { label: '旋转速度',      desc: '关节旋转的瞬时速度' },
  displacement_velocity:   { label: '位移速度',      desc: '身体部位位移的执行速度，反映动作节奏' },
};

function featureLabel(code: string): string {
  return FEATURE_META[code]?.label || code;
}

function featureDesc(code: string): string {
  return FEATURE_META[code]?.desc || '';
}

// 向后兼容：表格列用短标签
function featureShortLabel(code: string): string {
  return featureLabel(code);
}

const NON_FEATURE_KEYS = new Set(['_meta', 'confidence_min', 'sigma_multiplier']);

function featureKeys(row: ThresholdConfigDto): string[] {
  const cfg = row.thresholdConfig || {};
  return Object.keys(cfg).filter((k) => !NON_FEATURE_KEYS.has(k) && typeof cfg[k] === 'object' && cfg[k] !== null);
}

function extractSigma(row: ThresholdConfigDto): string {
  const cfg = row.thresholdConfig || {};
  const meta = cfg._meta as Record<string, unknown> | undefined;
  if (meta && typeof meta.sigma_multiplier === 'number') return String(meta.sigma_multiplier);
  if (typeof cfg.sigma_multiplier === 'number') return String(cfg.sigma_multiplier);
  return '-';
}

function sigmaTagType(row: ThresholdConfigDto): string {
  const v = parseFloat(extractSigma(row));
  if (isNaN(v)) return 'info';
  if (v <= 1.5) return 'warning';
  if (v <= 2.0) return '';
  return 'success';
}

function isFeatureOverTight(row: ThresholdConfigDto, code: string): boolean {
  const cfg = (row.thresholdConfig || {}) as Record<string, any>;
  const feat = cfg[code];
  if (!feat || !Array.isArray(feat.valid_range)) return false;
  const goldStd = feat.gold_std ?? 0;
  if (goldStd <= 0) return false;
  const width = Math.abs(feat.valid_range[1] - feat.valid_range[0]);
  return width < goldStd;
}

function dirTagType(direction: string): string {
  if (direction === 'larger_better') return 'success';
  if (direction === 'smaller_better') return 'danger';
  return 'warning';
}

function dirLabel(direction: string): string {
  if (direction === 'larger_better') return '越大越好';
  if (direction === 'smaller_better') return '越小越好';
  return '适度';
}

/* ============================================================ */
/*  核心参数调优弹窗                                              */
/* ============================================================ */

interface TuneFeature {
  code: string;
  unit: string;
  direction: string;
  goldMean: number | null;
  goldStd: number | null;
  validLo: number;
  validHi: number;
  warnLo: number;
  warnHi: number;
}

const tuneDialogVisible = ref(false);
const tuningItem = ref<ThresholdConfigDto | null>(null);
const tuneSigma = ref(1.8);
const tuneFeatures = reactive<TuneFeature[]>([]);
const showAllFeatures = ref(false);
const presetMode = ref<'strict' | 'balanced' | 'loose'>('balanced');
const actionStatus = ref('');

const SIGMA_PRESETS = [
  { key: 'strict', value: 1.5, label: '1.5' },
  { key: 'balanced', value: 1.8, label: '1.8' },
  { key: 'loose', value: 2.0, label: '2.0' },
] as const;

// 卡片式档位配置：只控制门限倍数，区间独立重算
const PRESET_CONFIGS = [
  {
    key: 'strict' as const,
    name: '严格',
    sigma: 1.5,
    desc: '实测偏差 < 1.5 × 标准差 才判正常',
  },
  {
    key: 'balanced' as const,
    name: '平衡',
    sigma: 1.8,
    desc: '实测偏差 < 1.8 × 标准差 才判正常（推荐）',
  },
  {
    key: 'loose' as const,
    name: '宽松',
    sigma: 2.0,
    desc: '实测偏差 < 2.0 × 标准差 才判正常',
  },
];

// 区间宽度倍数（独立于门限倍数）
const rangeValidMult = ref(2);
const rangeWarnMult = ref(3);

function recomputeRanges() {
  const { touched, changed } = applySigmaRangeTemplate(rangeValidMult.value, rangeWarnMult.value);
  if (!touched) {
    actionStatus.value = '特征缺少金标准数据，无法重算区间';
    return;
  }
  if (changed === 0) {
    actionStatus.value = `区间已是目标值（有效 ±${rangeValidMult.value}σ，警告 ±${rangeWarnMult.value}σ），无需变更`;
  } else {
    actionStatus.value = `已重算区间：${changed}/${touched} 个特征已更新（有效 ±${rangeValidMult.value}σ，警告 ±${rangeWarnMult.value}σ）`;
    ElMessage.success(`区间已重算 ${changed}/${touched} 个特征`);
  }
}

const tuneSigmaTagType = computed(() => {
  const v = tuneSigma.value;
  if (v <= 1.5) return 'warning';
  if (v <= 2.0) return '';
  return 'success';
});

const tuneSigmaLabel = computed(() => {
  const v = tuneSigma.value;
  if (v <= 1.5) return '偏严格';
  if (v <= 1.8) return '标准';
  if (v <= 2.0) return '偏宽松';
  return '宽松';
});

// presetHint 已不再使用，保留 tuneSigmaTagType / tuneSigmaLabel 供其他场景

const CORE_FEATURES_BY_ACTION: Record<TrainingActionType, string[]> = {
  abdominal_crunch: ['abdominal_displacement', 'trunk_angle_change', 'hold_duration', 'displacement_velocity'],
  pelvic_tilt: ['pelvic_tilt_delta', 'pelvis_shift', 'hold_duration', 'trunk_angle_change'],
  knee_rotation: ['knee_rotation_angle', 'knee_symmetry', 'rotation_velocity', 'trunk_angle_change'],
};

// 当核心特征数 < 全部特征数时才显示 Tab 过滤
const hasCoreFilter = computed(() => {
  if (!tuningItem.value) return false;
  const whitelist = CORE_FEATURES_BY_ACTION[tuningItem.value.actionType] || [];
  const coreCount = tuneFeatures.filter((f) => whitelist.includes(f.code)).length;
  return coreCount > 0 && coreCount < tuneFeatures.length;
});

const displayedTuneFeatures = computed(() => {
  if (showAllFeatures.value || !tuningItem.value || !hasCoreFilter.value) return tuneFeatures;
  const whitelist = CORE_FEATURES_BY_ACTION[tuningItem.value.actionType] || [];
  const filtered = tuneFeatures.filter((feat) => whitelist.includes(feat.code));
  return filtered.length ? filtered : tuneFeatures;
});

// 计算当前有效上限对应几倍特征标准差
function calcUpperBound(feat: TuneFeature, sigmaMult: number): string {
  if (feat.goldMean == null || feat.goldStd == null || feat.goldStd <= 0) return '-';
  const upper = feat.goldMean + sigmaMult * feat.goldStd;
  return round4(upper).toString();
}

function featureStep(feat: TuneFeature): number {
  const std = feat.goldStd ?? 0;
  if (std <= 0) return 0.005;
  const s = std / 50;
  if (s < 0.005) return 0.005;
  if (s < 0.01) return 0.01;
  if (s < 0.02) return 0.02;
  if (s < 0.05) return 0.05;
  return 0.1;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function rangeByDirection(mean: number, std: number, direction: string, sigma: number): [number, number] {
  const safeStd = Math.max(0, std);
  if (safeStd <= 0) return [round4(mean), round4(mean)];
  if (direction === 'smaller_better') return [0, round4(mean + sigma * safeStd)];
  if (direction === 'larger_better') return [round4(Math.max(0, mean - sigma * safeStd)), round4(mean + sigma * safeStd)];
  return [round4(mean - sigma * safeStd), round4(mean + sigma * safeStd)];
}

function applySigmaRangeTemplate(validSigma: number, warningSigma: number) {
  let touched = 0; let changed = 0;
  for (const feat of tuneFeatures) {
    if (feat.goldMean == null || feat.goldStd == null) continue;
    touched++;
    const prev = [feat.validLo, feat.validHi, feat.warnLo, feat.warnHi];
    const vr = rangeByDirection(feat.goldMean, feat.goldStd, feat.direction, validSigma);
    const wr = rangeByDirection(feat.goldMean, feat.goldStd, feat.direction, warningSigma);
    feat.validLo = vr[0]; feat.validHi = vr[1];
    feat.warnLo = Math.min(wr[0], vr[0]); feat.warnHi = Math.max(wr[1], vr[1]);
    if (prev[0] !== feat.validLo || prev[1] !== feat.validHi || prev[2] !== feat.warnLo || prev[3] !== feat.warnHi) changed++;
  }
  return { touched, changed };
}

function handlePresetChange(mode: 'strict' | 'balanced' | 'loose') {
  presetMode.value = mode;
  const sigmaMap = { strict: 1.5, balanced: 1.8, loose: 2.0 };
  tuneSigma.value = sigmaMap[mode];
  // 只更新门限倍数，不自动重算区间（区间由用户手动点「重算区间」触发）
  const label = mode === 'strict' ? '严格' : mode === 'loose' ? '宽松' : '平衡';
  actionStatus.value = `门限已切换为「${label}」（倍数 ×${tuneSigma.value}）——区间未变。如需同步重算区间，点「重算区间」按鈕。`;
}

function openTune(item: ThresholdConfigDto) {
  tuningItem.value = item;
  const cfg = (item.thresholdConfig || {}) as Record<string, any>;
  const meta = cfg._meta as Record<string, unknown> | undefined;
  tuneSigma.value = typeof meta?.sigma_multiplier === 'number'
    ? meta.sigma_multiplier
    : typeof cfg.sigma_multiplier === 'number' ? cfg.sigma_multiplier : 1.5;

  tuneFeatures.length = 0;
  for (const [key, val] of Object.entries(cfg)) {
    if (NON_FEATURE_KEYS.has(key) || typeof val !== 'object' || val === null) continue;
    const feat = val as Record<string, any>;
    const vr = Array.isArray(feat.valid_range) ? feat.valid_range : [null, null];
    const wr = Array.isArray(feat.warning_range) ? feat.warning_range : [null, null];
    tuneFeatures.push({
      code: key,
      unit: typeof feat.unit === 'string' ? feat.unit : '',
      direction: typeof feat.direction === 'string' ? feat.direction : '',
      goldMean: typeof feat.gold_mean === 'number' ? feat.gold_mean : null,
      goldStd: typeof feat.gold_std === 'number' ? feat.gold_std : null,
      validLo: typeof vr[0] === 'number' ? vr[0] : 0,
      validHi: typeof vr[1] === 'number' ? vr[1] : 0,
      warnLo: typeof wr[0] === 'number' ? wr[0] : 0,
      warnHi: typeof wr[1] === 'number' ? wr[1] : 0,
    });
  }

  showAllFeatures.value = false;
  presetMode.value = tuneSigma.value <= 1.6 ? 'strict' : tuneSigma.value >= 1.95 ? 'loose' : 'balanced';
  actionStatus.value = '';
  rangeValidMult.value = 2;
  rangeWarnMult.value = 3;
  tuneDialogVisible.value = true;
}

function handleTuneSave() {
  if (!tuningItem.value) return;
  const cfg = JSON.parse(JSON.stringify(tuningItem.value.thresholdConfig || {})) as Record<string, any>;
  if (!cfg._meta) cfg._meta = {};
  cfg._meta.sigma_multiplier = tuneSigma.value;
  cfg.sigma_multiplier = tuneSigma.value;
  for (const feat of tuneFeatures) {
    if (!cfg[feat.code] || typeof cfg[feat.code] !== 'object') continue;
    cfg[feat.code].valid_range = [feat.validLo, feat.validHi];
    cfg[feat.code].warning_range = [feat.warnLo, feat.warnHi];
  }
  saveConfig(tuningItem.value.actionType, cfg);
}

/* ============================================================ */
/*  JSON 高级编辑弹窗                                             */
/* ============================================================ */

const jsonDialogVisible = ref(false);
const jsonEditingItem = ref<ThresholdConfigDto | null>(null);
const jsonEditConfigStr = ref('');

function openJsonEdit(item: ThresholdConfigDto) {
  jsonEditingItem.value = item;
  jsonEditConfigStr.value = JSON.stringify(item.thresholdConfig, null, 2);
  jsonDialogVisible.value = true;
}

function handleJsonSave() {
  if (!jsonEditingItem.value) return;
  let configObj: Record<string, unknown>;
  try {
    configObj = JSON.parse(jsonEditConfigStr.value);
  } catch {
    ElMessage.error('请输入合法的 JSON 格式');
    return;
  }
  saveConfig(jsonEditingItem.value.actionType, configObj);
}

/* ============================================================ */
/*  统一保存                                                      */
/* ============================================================ */

async function saveConfig(actionType: TrainingActionType, configObj: Record<string, unknown>) {
  saving.value = true;
  try {
    await updateThreshold(actionType, configObj);
    ElMessage.success('保存成功');
    tuneDialogVisible.value = false;
    jsonDialogVisible.value = false;
    loadData();
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

onMounted(loadData);
</script>

<style scoped>
.threshold-guide { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; margin: 0 0 16px; border: 1px solid #d6e8f3; border-radius: 12px; color: #5a7286; background: #f5faff; font-size: 12px; line-height: 1.65; }
.threshold-guide strong { margin-right: 8px; color: #285f80; }.threshold-guide__mark { display: grid; flex: 0 0 auto; width: 17px; height: 17px; place-items: center; border-radius: 50%; color: #fff; background: #56a8ce; font-family: Georgia, serif; font-size: 11px; font-weight: 700; }
/* ── 特征标签 ─────────────────────────────── */
.feature-chips { display: flex; flex-wrap: wrap; gap: 6px; }

/* ── 特征筛选 Tab ────────────────────────── */
.feat-tab-group {
  display: flex;
  background: rgba(15,23,42,0.06);
  border-radius: 8px;
  padding: 3px;
  gap: 2px;
}
.feat-tab {
  padding: 4px 12px;
  font-size: 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  transition: all .15s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.feat-tab:hover { color: var(--el-text-color-primary); }
.feat-tab--active {
  background: #fff;
  color: var(--el-color-primary);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
}
.feat-tab__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  border-radius: 10px;
  background: rgba(99,102,241,0.12);
  color: #6366f1;
  font-size: 10px;
  font-weight: 600;
}
.feature-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  background: rgba(99,102,241,0.08);
  color: #6366f1;
  border: 1px solid rgba(99,102,241,0.12);
}
.feature-chip--warn { background: rgba(245,158,11,0.1); color: #d97706; border-color: rgba(245,158,11,0.2); }

/* ── 调优弹窗布局：由遮罩层强制居中，避免 Teleport 后脱离 scoped 样式 ── */
:global(.el-overlay.tune-dialog-overlay) { display: flex; align-items: center; justify-content: center; overflow: auto; }
:global(.el-overlay.tune-dialog-overlay .el-overlay-dialog) { width: 100%; min-height: 100%; display: flex; align-items: center; justify-content: center; }
:global(.el-dialog.tune-dialog) { width: 820px; height: 1000px; margin: 0 !important; display: flex; flex-direction: column; }
:global(.el-dialog.tune-dialog .el-dialog__body) { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; padding-top: 10px !important; }
:global(.el-dialog.tune-dialog .tune-dialog__body) { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 4px 8px; overscroll-behavior: contain; }
:global(.el-dialog.tune-dialog .el-dialog__footer) { flex: 0 0 auto; padding-top: 14px !important; border-top: 1px solid var(--el-border-color-lighter); }
/* ── 调优弹窗顶部 ─────────────────────────── */
.tune-header { margin-bottom: 14px; }
.tune-meta {
  display: flex;
  gap: 28px;
  padding: 10px 14px;
  background: rgba(15,23,42,0.03);
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 10px;
}
.tune-header__item { display: flex; flex-direction: column; gap: 2px; }
.tune-header__label { font-size: 11px; color: var(--el-text-color-secondary); }
.tune-header__value { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }

/* ── 宽松度选择区（卡片式档位）───────────── */
.preset-bar {
  padding: 12px 14px;
  border: 1px solid rgba(99,102,241,0.18);
  border-radius: 12px;
  background: rgba(99,102,241,0.03);
  margin-bottom: 14px;
}
.preset-bar__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.preset-bar__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.preset-bar__sigma {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.preset-bar__sigma b {
  color: var(--el-color-primary);
  font-size: 14px;
}
.preset-bar__status {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 4px 8px;
  background: rgba(0,0,0,0.03);
  border-radius: 6px;
}
.preset-bar__range-row {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(99,102,241,0.15);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.preset-bar__range-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.preset-bar__range-inputs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.preset-bar__range-tag {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.preset-bar__range-eq {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.range-mult-sep {
  color: rgba(0,0,0,0.12);
  font-size: 16px;
  margin: 0 2px;
}
.range-mult-input {
  display: inline-flex;
  align-items: center;
  background: #fff;
  border: 1px solid rgba(99,102,241,0.3);
  border-radius: 20px;
  padding: 0 2px;
  gap: 0;
}
.range-mult-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .12s;
  line-height: 1;
}
.range-mult-btn:hover { background: rgba(99,102,241,0.1); }
.range-mult-val {
  min-width: 28px;
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  color: var(--el-color-primary);
  font-family: monospace;
}
.preset-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid rgba(0,0,0,0.08);
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: all .15s;
}
.preset-card:hover {
  border-color: rgba(99,102,241,0.4);
  background: rgba(99,102,241,0.04);
}
.preset-card--active {
  border-color: var(--el-color-primary);
  background: rgba(99,102,241,0.06);
  box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
}
.preset-card__name {
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}
.preset-card--active .preset-card__name { color: var(--el-color-primary); }
.preset-card__sigma {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  font-family: monospace;
}
.preset-card--active .preset-card__sigma { color: var(--el-color-primary); }
.preset-card__desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

/* ── 特征区间列表 ─────────────────────────── */
.features-section { }
.features-section__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding-top: 2px;
}
.features-section__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  flex: 1;
}
.features-section__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.feat-row {
  display: grid;
  grid-template-columns: 220px 1fr;
  align-items: start;
  gap: 20px;
  padding: 14px 16px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.07);
  margin-bottom: 6px;
  transition: box-shadow .15s;
}
.feat-row:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.07); }
.feat-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.feat-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.feat-code {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
  font-family: monospace;
  letter-spacing: 0.3px;
}
.feat-desc {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}
.feat-ref {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.feat-ref-calc {
  display: block;
  font-size: 10px;
  color: #6366f1;
  margin-top: 1px;
}

.feat-ranges {
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.range-label {
  flex: 0 0 32px;
  font-size: 11px;
  font-weight: 700;
  text-align: right;
  letter-spacing: 0.3px;
}
.range-label--valid {
  color: #0f766e;
}
.range-label--warn {
  color: #b45309;
}
.range-pair {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}
.range-sep {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.range-input {
  flex: 1;
  min-width: 0;
}
.range-input :deep(.el-input-number) { width: 100% !important; }
.range-input :deep(.el-input__wrapper) {
  border-radius: 10px;
  border: 1px solid rgba(99,102,241,0.2);
  box-shadow: none;
  padding: 0 10px;
}

/* ── JSON 编辑警告 ──────────────────────────── */
.json-edit-warn {
  background: rgba(245,158,11,0.08);
  border: 1px solid rgba(245,158,11,0.2);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: #92400e;
  margin-bottom: 16px;
  line-height: 1.6;
}

/* ── 响应式 ─────────────────────────────────── */
@media (max-width: 768px) {
  .preset-cards { grid-template-columns: 1fr; }
  .feat-row { grid-template-columns: 1fr; align-items: flex-start; }
  .feat-info { flex: none; }
  .range-row { flex-wrap: wrap; }
}
</style>
