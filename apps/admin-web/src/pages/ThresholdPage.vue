<template>
  <div class="admin-page threshold-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Template Thresholds</div>
          <h1 class="page-hero__title">阈值参数管理</h1>
          <p class="page-hero__subtitle">
以金标准统计为起点生成评分门限：动作幅度和保持时间看下限，代偿和晃动看上限，速度等指标使用合理区间。
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
        <div><strong>如何理解这些参数？</strong><span>σ 倍数只用于生成建议门限：幅度/保持不足看下限，代偿/晃动超标看上限，速度使用双向区间。正常之外、预警之内为「警告」；超出预警门限才是「无效」。</span></div>
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

      <div class="motion-guide" v-if="tuningActionGuide">
        <div class="motion-guide__title">{{ tuningActionGuide.title }}</div>
        <div class="motion-guide__summary">{{ tuningActionGuide.summary }}</div>
        <div class="motion-guide__checks">
          <span><b>主要看：</b>{{ tuningActionGuide.primary }}</span>
          <span><b>同时控制：</b>{{ tuningActionGuide.control }}</span>
          <span><b>操作建议：</b>{{ tuningActionGuide.tip }}</span>
        </div>
      </div>

      <div class="traffic-light-guide" role="note">
        <span class="traffic-light-guide__title">门限就像动作质量的红绿灯</span>
        <span><b class="traffic-light-guide__normal">正常</b>：符合金标准表现</span>
        <span><b class="traffic-light-guide__warning">预警</b>：存在轻微偏差，建议关注</span>
        <span><b class="traffic-light-guide__invalid">无效</b>：偏差较大，本周期不计入有效动作</span>
      </div>

      <!-- 宽松度选择（合并 σ + 档位） -->
      <div class="preset-bar">
        <div class="preset-bar__top">
          <span class="preset-bar__title">建议门限宽松度</span>
          <span class="preset-bar__sigma">本次生成倍数 = <b>{{ tuneSigma }}σ</b></span>
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
            <span class="preset-card__sigma">建议值 {{ p.sigma }}σ</span>
            <span class="preset-card__desc">{{ p.desc }}</span>
          </button>
        </div>
        <div class="preset-bar__range-row">
          <span class="preset-bar__range-label">应用建议：</span>
          <span class="preset-bar__range-eq">按 {{ tuneSigma }}σ 生成正常门限，预警门限自动放宽为 {{ warningSigma }}σ；可在下方逐项微调。</span>
          <el-button size="small" type="primary" plain @click="recomputeRanges">按建议重算门限</el-button>
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
              <el-tag v-if="feat.scoringMode" size="small" :type="scoringModeTagType(feat.scoringMode)">
                {{ scoringModeTagLabel(feat.scoringMode) }}
              </el-tag>
            </div>
            <div class="feat-code">{{ feat.code }}</div>
            <div class="feat-desc" v-if="featureDesc(feat.code)">{{ featureDesc(feat.code) }}</div>
            <div class="feat-ref" v-if="feat.goldMean != null">
              金标准均值 {{ feat.goldMean }} / 标准差 {{ feat.goldStd }}
              <span class="feat-ref-calc">→ {{ scoringRuleLabel(feat.scoringMode) }}</span>
            </div>
          </div>
          <!-- 右：按评分语义展示真正会生效的门限，避免将单向指标误解成双向区间。 -->
          <div class="feat-ranges">
            <template v-if="feat.scoringMode === 'lower_bound'">
              <div class="range-row">
                <span class="range-label range-label--valid">正常下限</span>
                <el-input-number v-model="feat.normalMin" :min="0" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input range-input--single" />
                <span class="range-hint">达到或超过此值为正常</span>
              </div>
              <div class="range-row">
                <span class="range-label range-label--warn">预警下限</span>
                <el-input-number v-model="feat.warningMin" :min="0" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input range-input--single" />
                <span class="range-hint">低于此值判无效</span>
              </div>
            </template>
            <template v-else-if="feat.scoringMode === 'upper_bound'">
              <div class="range-row">
                <span class="range-label range-label--valid">正常上限</span>
                <el-input-number v-model="feat.normalMax" :min="0" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input range-input--single" />
                <span class="range-hint">不超过此值为正常</span>
              </div>
              <div class="range-row">
                <span class="range-label range-label--warn">预警上限</span>
                <el-input-number v-model="feat.warningMax" :min="0" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input range-input--single" />
                <span class="range-hint">超过此值判无效</span>
              </div>
            </template>
            <template v-else>
              <div class="range-row">
                <span class="range-label range-label--valid">正常区间</span>
                <div class="range-pair"><el-input-number v-model="feat.validLo" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" /><span class="range-sep">~</span><el-input-number v-model="feat.validHi" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" /></div>
              </div>
              <div class="range-row">
                <span class="range-label range-label--warn">预警区间</span>
                <div class="range-pair"><el-input-number v-model="feat.warnLo" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" /><span class="range-sep">~</span><el-input-number v-model="feat.warnHi" :precision="4" :step="featureStep(feat)" :controls="false" size="small" class="range-input" /></div>
              </div>
            </template>
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
  pelvis_shift:            { label: '骨盆平移代偿', desc: '动作时骨盆横向滑动的幅度；越小表示越稳定、代偿越少' },
  pelvic_tilt_delta:       { label: '骨盆前后倾斜幅度', desc: '骨盆前倾/后倾的角度变化量；幅度不足说明动作没有做到位' },
  pelvic_tilt_velocity:    { label: '骨盆倾斜速度', desc: '骨盆倾斜动作的执行速度，反映动作节奏控制' },
  hold_duration:           { label: '保持时长',     desc: '在目标姿态上维持的时间，反映肌肉耐力' },
  knee_rotation_range:     { label: '膝关节旋转幅度', desc: '膝关节旋转的角度范围，核心动作主指标' },
  knee_rotation_velocity:  { label: '膝关节旋转速度', desc: '旋转动作的执行速度，反映动作节奏控制' },
  knee_rotation_angle:     { label: '膝关节旋转幅度', desc: '单次倒膝的最大旋转幅度；幅度不足说明活动范围不够' },
  knee_symmetry:           { label: '左右旋转对称性', desc: '左右两侧旋转幅度的均衡程度；偏离参考范围提示控制不均衡' },
  rotation_velocity:       { label: '旋转节奏',       desc: '完成倒膝旋转的速度；过快或过慢都可能影响动作控制' },
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

const NON_FEATURE_KEYS = new Set(['_meta', 'confidence_min', 'sigma_multiplier', 'confidenceMin', 'sigmaMultiplier']);

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

function scoringModeTagType(mode: TuneFeature['scoringMode']): string {
  if (mode === 'lower_bound') return 'success';
  if (mode === 'upper_bound') return 'danger';
  return 'warning';
}

function scoringModeTagLabel(mode: TuneFeature['scoringMode']): string {
  if (mode === 'lower_bound') return '看下限';
  if (mode === 'upper_bound') return '看上限';
  return '双向区间';
}

/* ============================================================ */
/*  核心参数调优弹窗                                              */
/* ============================================================ */

interface TuneFeature {
  code: string;
  unit: string;
  direction: string;
  scoringMode: 'lower_bound' | 'upper_bound' | 'two_sided';
  goldMean: number | null;
  goldStd: number | null;
  normalMin: number;
  warningMin: number;
  normalMax: number;
  warningMax: number;
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
const ACTION_TUNING_GUIDES: Record<TrainingActionType, { title: string; summary: string; primary: string; control: string; tip: string }> = {
  abdominal_crunch: {
    title: '缩腹运动：先保证收腹做到位，再减少借力晃动',
    summary: '幅度与保持时长不足会影响有效次数；躯干晃动过大提示存在代偿。',
    primary: '腹部收缩幅度、顶峰保持时长（看下限）',
    control: '躯干代偿、收缩节奏（看上限或合理区间）',
    tip: '优先核对有效次数，再微调单项门限。',
  },
  pelvic_tilt: {
    title: '骨盆倾斜：先保证前后倾斜充分，再避免骨盆横向滑动',
    summary: '核心是骨盆前后倾斜幅度；横向平移和躯干晃动过大属于代偿。',
    primary: '骨盆前后倾斜幅度、顶峰保持时长（看下限）',
    control: '骨盆平移代偿、躯干代偿（看上限）',
    tip: '若次数偏少，先确认幅度下限是否过高，再检查代偿上限。',
  },
  knee_rotation: {
    title: '膝关节旋转：保证倒膝幅度充分、左右均衡，并保持平稳节奏',
    summary: '幅度不足会漏记动作；左右不均或节奏过快/过慢会提示控制质量下降。',
    primary: '膝关节旋转幅度（看下限）',
    control: '左右旋转对称性、旋转节奏（双向区间）及躯干代偿（看上限）',
    tip: '先看幅度是否达标；再根据流程验证中的左右差异和节奏结果微调。',
  },
};

const tuningActionGuide = computed(() => tuningItem.value ? ACTION_TUNING_GUIDES[tuningItem.value.actionType] : null);

const PRESET_CONFIGS = [
  {
    key: 'strict' as const,
    name: '严格',
    sigma: 1.5,
    desc: '更容易识别轻微动作偏差，适合已充分验证的模板',
  },
  {
    key: 'balanced' as const,
    name: '平衡',
    sigma: 1.8,
    desc: '兼顾动作区分度和拍摄波动，适合日常验证',
  },
  {
    key: 'loose' as const,
    name: '宽松',
    sigma: 2.0,
    desc: '更能包容个体差异，建议作为新模板首轮验证值',
  },
];

const warningSigma = computed(() => round4(tuneSigma.value * 1.5));

function recomputeRanges() {
  const { touched, changed } = applySigmaRangeTemplate(tuneSigma.value, warningSigma.value);
  if (!touched) {
    actionStatus.value = '特征缺少金标准数据，无法按建议重算门限';
    return;
  }
  actionStatus.value = changed === 0
    ? `所有特征已符合当前建议（正常 ${tuneSigma.value}σ，预警 ${warningSigma.value}σ）`
    : `已按当前建议更新 ${changed}/${touched} 个特征（正常 ${tuneSigma.value}σ，预警 ${warningSigma.value}σ）`;
  if (changed > 0) ElMessage.success(`已更新 ${changed}/${touched} 个特征门限`);
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

function scoringRuleLabel(mode: TuneFeature['scoringMode']): string {
  if (mode === 'lower_bound') return '数值越高越充分：不足时先预警，明显不足则无效';
  if (mode === 'upper_bound') return '数值越低越稳定：超标时先预警，明显超标则无效';
  return '位于正常区间为正常；轻微偏离预警，明显偏离则无效';
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

function effectiveStd(mean: number, std: number): number {
  return Math.max(std, Math.max(Math.abs(mean) * 0.05, 0.05));
}

function applySigmaRangeTemplate(normalSigma: number, warnSigma: number) {
  let touched = 0; let changed = 0;
  for (const feat of tuneFeatures) {
    if (feat.goldMean == null || feat.goldStd == null) continue;
    touched++;
    const safeStd = effectiveStd(feat.goldMean, feat.goldStd);
    const prev = JSON.stringify(feat);
    if (feat.scoringMode === 'lower_bound') {
      feat.normalMin = Math.max(0, round4(feat.goldMean - normalSigma * safeStd));
      feat.warningMin = Math.max(0, round4(feat.goldMean - warnSigma * safeStd));
      feat.validLo = feat.normalMin; feat.validHi = Number.MAX_SAFE_INTEGER;
      feat.warnLo = feat.warningMin; feat.warnHi = Number.MAX_SAFE_INTEGER;
    } else if (feat.scoringMode === 'upper_bound') {
      feat.normalMax = Math.max(0, round4(feat.goldMean + normalSigma * safeStd));
      feat.warningMax = Math.max(0, round4(feat.goldMean + warnSigma * safeStd));
      feat.validLo = 0; feat.validHi = feat.normalMax;
      feat.warnLo = 0; feat.warnHi = feat.warningMax;
    } else {
      feat.validLo = round4(feat.goldMean - normalSigma * safeStd);
      feat.validHi = round4(feat.goldMean + normalSigma * safeStd);
      feat.warnLo = round4(feat.goldMean - warnSigma * safeStd);
      feat.warnHi = round4(feat.goldMean + warnSigma * safeStd);
    }
    if (prev !== JSON.stringify(feat)) changed++;
  }
  return { touched, changed };
}

function handlePresetChange(mode: 'strict' | 'balanced' | 'loose') {
  presetMode.value = mode;
  const sigmaMap = { strict: 1.5, balanced: 1.8, loose: 2.0 };
  tuneSigma.value = sigmaMap[mode];
  const label = mode === 'strict' ? '严格' : mode === 'loose' ? '宽松' : '平衡';
  actionStatus.value = `已选择「${label}」建议（${tuneSigma.value}σ）；点击「按建议重算门限」后才会更新各项数值。`; 
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
    const direction = typeof feat.direction === 'string' ? feat.direction : '';
    const scoringMode = feat.scoring_mode === 'lower_bound' || feat.scoring_mode === 'upper_bound'
      ? feat.scoring_mode
      : direction === 'larger_better' ? 'lower_bound'
        : direction === 'smaller_better' ? 'upper_bound'
          : 'two_sided';
    const validLo = typeof vr[0] === 'number' ? vr[0] : 0;
    const validHi = typeof vr[1] === 'number' ? vr[1] : 0;
    const warnLo = typeof wr[0] === 'number' ? wr[0] : 0;
    const warnHi = typeof wr[1] === 'number' ? wr[1] : 0;
    tuneFeatures.push({
      code: key,
      unit: typeof feat.unit === 'string' ? feat.unit : '',
      direction,
      scoringMode,
      goldMean: typeof feat.gold_mean === 'number' ? feat.gold_mean : null,
      goldStd: typeof feat.gold_std === 'number' ? feat.gold_std : null,
      normalMin: typeof feat.normal_min === 'number' ? feat.normal_min : validLo,
      warningMin: typeof feat.warning_min === 'number' ? feat.warning_min : warnLo,
      normalMax: typeof feat.normal_max === 'number' ? feat.normal_max : validHi,
      warningMax: typeof feat.warning_max === 'number' ? feat.warning_max : warnHi,
      validLo,
      validHi,
      warnLo,
      warnHi,
    });
  }

  showAllFeatures.value = false;
  presetMode.value = tuneSigma.value <= 1.6 ? 'strict' : tuneSigma.value >= 1.95 ? 'loose' : 'balanced';
  actionStatus.value = '';
tuneDialogVisible.value = true;
}

function handleTuneSave() {
  if (!tuningItem.value) return;
  for (const feat of tuneFeatures) {
    if (feat.scoringMode === 'lower_bound' && feat.warningMin > feat.normalMin) {
      ElMessage.error(`${featureLabel(feat.code)}：预警下限不能高于正常下限`);
      return;
    }
    if (feat.scoringMode === 'upper_bound' && feat.warningMax < feat.normalMax) {
      ElMessage.error(`${featureLabel(feat.code)}：预警上限不能低于正常上限`);
      return;
    }
    if (feat.scoringMode === 'two_sided' && (feat.validLo > feat.validHi || feat.warnLo > feat.warnHi || feat.warnLo > feat.validLo || feat.warnHi < feat.validHi)) {
      ElMessage.error(`${featureLabel(feat.code)}：预警区间必须完整包含正常区间`);
      return;
    }
  }

  const cfg = JSON.parse(JSON.stringify(tuningItem.value.thresholdConfig || {})) as Record<string, any>;
  if (!cfg._meta) cfg._meta = {};
  cfg._meta.sigma_multiplier = tuneSigma.value;
  cfg.sigma_multiplier = tuneSigma.value;
  for (const feat of tuneFeatures) {
    if (!cfg[feat.code] || typeof cfg[feat.code] !== 'object') continue;
    cfg[feat.code].scoring_mode = feat.scoringMode;
    if (feat.scoringMode === 'lower_bound') {
      cfg[feat.code].normal_min = feat.normalMin;
      cfg[feat.code].warning_min = feat.warningMin;
      cfg[feat.code].valid_range = [feat.normalMin, Number.MAX_SAFE_INTEGER];
      cfg[feat.code].warning_range = [feat.warningMin, Number.MAX_SAFE_INTEGER];
    } else if (feat.scoringMode === 'upper_bound') {
      cfg[feat.code].normal_max = feat.normalMax;
      cfg[feat.code].warning_max = feat.warningMax;
      cfg[feat.code].valid_range = [0, feat.normalMax];
      cfg[feat.code].warning_range = [0, feat.warningMax];
    } else {
      cfg[feat.code].valid_range = [feat.validLo, feat.validHi];
      cfg[feat.code].warning_range = [feat.warnLo, feat.warnHi];
    }
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
.motion-guide { padding: 13px 15px; margin: 0 0 10px; border: 1px solid rgba(64,158,255,.28); border-radius: 10px; background: rgba(64,158,255,.055); }
.motion-guide__title { color: var(--el-text-color-primary); font-size: 14px; font-weight: 700; }.motion-guide__summary { margin-top: 4px; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }.motion-guide__checks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; color: var(--el-text-color-regular); font-size: 12px; line-height: 1.5; }.motion-guide__checks span { padding: 7px 8px; border-radius: 6px; background: rgba(255,255,255,.72); }.motion-guide__checks b { color: var(--el-color-primary); }
.traffic-light-guide { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 9px 12px; margin: 0 0 10px; border-radius: 8px; background: rgba(15,23,42,.035); color: var(--el-text-color-secondary); font-size: 12px; }.traffic-light-guide__title { color: var(--el-text-color-primary); font-weight: 700; }.traffic-light-guide b { padding: 1px 5px; border-radius: 4px; font-size: 11px; }.traffic-light-guide__normal { color: #287a4f; background: rgba(64,158,113,.13); }.traffic-light-guide__warning { color: #a66b00; background: rgba(230,162,60,.16); }.traffic-light-guide__invalid { color: #b53a3a; background: rgba(245,108,108,.13); }
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
.range-hint {
font-size: 11px;
color: var(--el-text-color-secondary);
white-space: nowrap;
margin-left: 6px;
}
.range-input--single { width: 110px; }
/* unused: kept for backwards compat of existing CSS rules below */
.range-mult-sep {
color: rgba(0,0,0,0.12);
font-size: 16px;
margin: 0 2px;
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
.motion-guide__checks { grid-template-columns: 1fr; }
.preset-cards { grid-template-columns: 1fr; }
  .feat-row { grid-template-columns: 1fr; align-items: flex-start; }
  .feat-info { flex: none; }
  .range-row { flex-wrap: wrap; }
}
</style>
