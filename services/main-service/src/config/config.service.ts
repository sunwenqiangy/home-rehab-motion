import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  MotivationRulesDto,
  PatientAppConfigDto,
  ThresholdConfigDto,
  UpdatePatientAppConfigRequestDto,
} from '@home-rehab-motion/shared-contract';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_ACTION_TYPES: TrainingActionType[] = ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'];
const PATIENT_APP_CONFIG_CACHE_TTL_MS = 60 * 1000;

const DEFAULT_MOTIVATION_RULES: MotivationRulesDto = {
  scoreSlightDelta: 3,
  scoreClearDelta: 8,
  stabilitySlightDelta: 3,
  stabilityClearDelta: 8,
  durationSlightDelta: 0.5,
  durationClearDelta: 1.5,
  repsSlightDelta: 1,
  repsClearDelta: 2,
};

const DEFAULT_APP_CONFIG: PatientAppConfigDto = {
  videoMinDurationSeconds: 10,
  // 与分析服务的 MAX_ANALYSIS_DURATION_SECONDS 保持一致；长视频仍由 Worker 帧预算限制计算量。
  videoMaxDurationSeconds: 300,
  videoRecordMaxDurationSeconds: 120,
  videoMaxSizeMB: 200,
  weeklyTarget: 7,
  analyzingMinWaitSeconds: 20,
  supportedActionTypes: ALLOWED_ACTION_TYPES,
};

type GoldFeatureDirection = 'larger_better' | 'smaller_better' | 'moderate';

type GoldFeatureMeta = {
  direction: GoldFeatureDirection;
  unit: string;
  description: string;
};

type GoldFeatureStats = {
  mean: number;
  std: number;
  min: number;
  max: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  n_cycles: number;
};

type GoldTemplateVersionType = 'gold_template' | 'threshold_tuning';

type GoldTemplateVersionView = {
  templateId: number;
  actionType: TrainingActionType;
  version: string;
  description: string;
  status: number;
  versionType: GoldTemplateVersionType;
  parentTemplateId?: number;
  changeSummary?: string;
  changeDiff?: Record<string, unknown>;
  everActivated: boolean;
  createdBy: string;
  createdAt: string;
  referenceStats: Record<string, unknown>;
  thresholdConfig: Record<string, unknown>;
};

type GoldTemplateGeneratePayload = {
  actionType: TrainingActionType;
  sourceVideoId: number;
  sourceVideoKey?: string;
  sourceVideoName?: string;
  sampleFps?: number;
  sigmaMultiplier?: number;
  notes?: string;
};

type GoldTemplateGenerateResult = {
  actionType: TrainingActionType;
  sourceVideoId: number;
  sourceVideoKey?: string;
  sourceVideoName?: string;
  qualityReport: {
    avgConfidence?: number;
    missingRate?: number;
    totalFrames?: number;
    validCycles?: number;
    qualityPass?: boolean;
    warnings?: string[];
  };
  referenceStats: Record<string, GoldFeatureStats>;
  thresholdConfig: Record<string, unknown>;
  compareSummary?: Record<string, unknown>;
  generatedAt: string;
};

type SaveGoldTemplatePayload = {
  actionType: TrainingActionType;
  version: string;
  description?: string;
  referenceStats: Record<string, unknown>;
  thresholdConfig: Record<string, unknown>;
};

type CreateThresholdVersionPayload = {
  actionType: TrainingActionType;
  thresholdConfig: Record<string, unknown>;
  changeSummary?: string;
  activate?: boolean;
  parentTemplateId?: number;
};

type GoldTemplateSourceVideo = {
  videoId: number;
  actionType: TrainingActionType;
  status: AnalysisStatus;
  uploadedAt: string;
  duration?: number;
  averageScore?: number;
  grade?: string;
};

const FEATURE_META: Record<TrainingActionType, Record<string, GoldFeatureMeta>> = {
  abdominal_crunch: {
    abdominal_displacement: {
      direction: 'larger_better',
      unit: 'deg',
      description: '腹部收缩屈曲幅度（越大说明收缩幅度越充分）',
    },
    displacement_velocity: {
      direction: 'moderate',
      unit: 'deg/s',
      description: '收缩速度（过快或过慢都可能影响质量）',
    },
    hold_duration: {
      direction: 'larger_better',
      unit: 's',
      description: '顶峰保持时长（越长说明控制更稳定）',
    },
    trunk_angle_change: {
      direction: 'smaller_better',
      unit: 'deg',
      description: '躯干代偿角度（越小越稳定）',
    },
  },
  pelvic_tilt: {
    pelvic_tilt_delta: {
      direction: 'larger_better',
      unit: 'deg',
      description: '骨盆倾斜幅度（越大说明动作范围越充分）',
    },
    pelvis_shift: {
      direction: 'smaller_better',
      unit: '%',
      description: '骨盆平移幅度（越小越稳定）',
    },
    hold_duration: {
      direction: 'larger_better',
      unit: 's',
      description: '顶峰保持时长（越长说明控制更稳定）',
    },
    trunk_angle_change: {
      direction: 'smaller_better',
      unit: 'deg',
      description: '躯干代偿角度（越小越稳定）',
    },
  },
  knee_rotation: {
    knee_rotation_angle: {
      direction: 'larger_better',
      unit: '%',
      description: '倒膝幅度（越大说明活动范围越充分）',
    },
    knee_symmetry: {
      direction: 'moderate',
      unit: '',
      description: '左右对称性（偏离过大说明控制不均衡）',
    },
    rotation_velocity: {
      direction: 'moderate',
      unit: '%/s',
      description: '倒膝速度（建议保持稳定节奏）',
    },
    trunk_angle_change: {
      direction: 'smaller_better',
      unit: 'deg',
      description: '躯干代偿角度（越小越稳定）',
    },
  },
};

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  const intValue = Math.round(value);
  return Math.min(Math.max(intValue, min), max);
}

function sanitizeSupportedActionTypes(value: unknown): TrainingActionType[] {
  if (!Array.isArray(value)) {
    return DEFAULT_APP_CONFIG.supportedActionTypes;
  }
  const sanitized = value.filter((item): item is TrainingActionType =>
    typeof item === 'string' && ALLOWED_ACTION_TYPES.includes(item as TrainingActionType),
  );
  return sanitized.length > 0 ? Array.from(new Set(sanitized)) : DEFAULT_APP_CONFIG.supportedActionTypes;
}

function normalizePatientAppConfig(raw: Partial<PatientAppConfigDto>): PatientAppConfigDto {
  const minDuration = pickNumber(raw.videoMinDurationSeconds, DEFAULT_APP_CONFIG.videoMinDurationSeconds, 1, 300);
  const maxDurationRaw = pickNumber(raw.videoMaxDurationSeconds, DEFAULT_APP_CONFIG.videoMaxDurationSeconds, 1, 300);
  const maxDuration = Math.max(minDuration, maxDurationRaw);
  const recordMaxDurationRaw = pickNumber(
    raw.videoRecordMaxDurationSeconds,
    DEFAULT_APP_CONFIG.videoRecordMaxDurationSeconds,
    1,
    300,
  );
  const recordMaxDuration = Math.max(minDuration, Math.min(maxDuration, recordMaxDurationRaw));

  return {
    videoMinDurationSeconds: minDuration,
    videoMaxDurationSeconds: maxDuration,
    videoRecordMaxDurationSeconds: recordMaxDuration,
    videoMaxSizeMB: pickNumber(raw.videoMaxSizeMB, DEFAULT_APP_CONFIG.videoMaxSizeMB, 10, 1024),
    weeklyTarget: pickNumber(raw.weeklyTarget, DEFAULT_APP_CONFIG.weeklyTarget, 1, 7),
    analyzingMinWaitSeconds: pickNumber(raw.analyzingMinWaitSeconds, DEFAULT_APP_CONFIG.analyzingMinWaitSeconds, 0, 180),
    supportedActionTypes: sanitizeSupportedActionTypes(raw.supportedActionTypes),
  };
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length * p) / 100)));
  return sorted[idx] ?? sorted[0];
}

function normalizeTemplateVersionView(row: {
  template_id: bigint;
  action_type: string;
  version: string;
  description: string | null;
  status: number;
  version_type: string;
  parent_template_id: bigint | null;
  change_summary: string | null;
  change_diff: Prisma.JsonValue | null;
  ever_activated: boolean;
  created_by: string | null;
  created_at: Date;
  reference_stats: Prisma.JsonValue | null;
  threshold_config: Prisma.JsonValue | null;
}): GoldTemplateVersionView {
  return {
    templateId: Number(row.template_id),
    actionType: row.action_type as TrainingActionType,
    version: row.version,
    description: row.description || '',
    status: row.status,
    versionType: row.version_type === 'threshold_tuning' ? 'threshold_tuning' : 'gold_template',
    parentTemplateId: row.parent_template_id ? Number(row.parent_template_id) : undefined,
    changeSummary: row.change_summary || undefined,
    changeDiff: (row.change_diff as Record<string, unknown>) || undefined,
    everActivated: row.ever_activated,
    createdBy: row.created_by || '',
    createdAt: row.created_at.toISOString(),
    referenceStats: (row.reference_stats as Record<string, unknown>) || {},
    thresholdConfig: (row.threshold_config as Record<string, unknown>) || {},
  };
}

@Injectable()
export class ConfigService {
  private patientAppConfigCache:
    | {
        value: PatientAppConfigDto;
        expiresAt: number;
      }
    | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private readCachedPatientAppConfig(): PatientAppConfigDto | null {
    const cache = this.patientAppConfigCache;
    if (!cache || cache.expiresAt <= Date.now()) {
      return null;
    }
    return { ...cache.value };
  }

  private writePatientAppConfigCache(config: PatientAppConfigDto) {
    this.patientAppConfigCache = {
      value: { ...config },
      expiresAt: Date.now() + PATIENT_APP_CONFIG_CACHE_TTL_MS,
    };
  }

  private ensureActionType(actionType: string): TrainingActionType {
    if (!ALLOWED_ACTION_TYPES.includes(actionType as TrainingActionType)) {
      throw new BadRequestException(`不支持的动作类型: ${actionType}`);
    }
    return actionType as TrainingActionType;
  }

  private buildFeatureStats(values: number[]): GoldFeatureStats {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);

    return {
      mean: round4(mean),
      std: round4(std),
      min: round4(sorted[0] ?? 0),
      max: round4(sorted[sorted.length - 1] ?? 0),
      p5: round4(percentile(sorted, 5)),
      p25: round4(percentile(sorted, 25)),
      p50: round4(percentile(sorted, 50)),
      p75: round4(percentile(sorted, 75)),
      p95: round4(percentile(sorted, 95)),
      n_cycles: values.length,
    };
  }

  private buildThresholdConfig(
    actionType: TrainingActionType,
    referenceStats: Record<string, GoldFeatureStats>,
    sigmaMultiplier: number,
  ): Record<string, unknown> {
    const safeSigma = Number.isFinite(sigmaMultiplier) && sigmaMultiplier > 0 ? sigmaMultiplier : 2;
    const featureMeta = FEATURE_META[actionType] || {};

    const thresholdConfig: Record<string, unknown> = {
      _meta: {
        action_type: actionType,
        sigma_multiplier: safeSigma,
        note: `基于 ${safeSigma}σ 自动生成单向/双向门限，建议先在流程验证页抽样复核`,
      },
      confidence_min: 0.6,
      sigma_multiplier: safeSigma,
      // 兼容前端旧键
      confidenceMin: 0.6,
      sigmaMultiplier: safeSigma,
    };

    Object.entries(referenceStats).forEach(([featureCode, stats]) => {
      const meta = featureMeta[featureCode] || {
        direction: 'moderate',
        unit: '',
        description: featureCode,
      };
      const mean = stats.mean;
      const std = stats.std;

      let validRange: [number, number];
      let warningRange: [number, number];
      const safeStd = Math.max(std, Math.max(Math.abs(mean) * 0.05, 0.05));

      if (meta.direction === 'larger_better') {
        // 幅度、保持时间等“越大越好”的特征只限制下限；超过金标准不应被当作异常。
        let normalMin = Math.max(0, round4(mean - safeSigma * safeStd));
        let warningMin = Math.max(0, round4(mean - safeSigma * 1.5 * safeStd));

        // 骨盆倾斜使用画面平面内髋线角度极差。缩腹误选该模式时会产生约
        // 1.38°~2.18° 的关键点噪声；自动统计模板不得把下限降入此噪声区间。
        // 此处是经过动作类型标定的业务下限，而非通用 σ 门限，避免下次重生成
        // 金标准后覆盖已验证的误选动作保护。
        if (actionType === 'pelvic_tilt' && featureCode === 'pelvic_tilt_delta') {
          normalMin = Math.max(normalMin, 3.0);
          warningMin = Math.max(warningMin, 2.5);
        }

        // 配置会被 JSON 持久化，Infinity 会被序列化为 null；使用足够大的有限值仅用于管理端展示。
        validRange = [normalMin, Number.MAX_SAFE_INTEGER];
        warningRange = [warningMin, Number.MAX_SAFE_INTEGER];
        thresholdConfig[featureCode] = {
          valid_range: validRange,
          warning_range: warningRange,
          scoring_mode: 'lower_bound',
          normal_min: normalMin,
          warning_min: warningMin,
          gold_mean: mean,
          gold_std: std,
          unit: meta.unit,
          description: meta.description,
          direction: meta.direction,
        };
        return;
      }

      if (meta.direction === 'smaller_better') {
        // 代偿、晃动等“越小越好”的特征只限制上限；更小代表更稳定，不能扣分。
        const normalMax = Math.max(0, round4(mean + safeSigma * safeStd));
        const warningMax = Math.max(0, round4(mean + safeSigma * 1.5 * safeStd));
        validRange = [0, normalMax];
        warningRange = [0, warningMax];
        thresholdConfig[featureCode] = {
          valid_range: validRange,
          warning_range: warningRange,
          scoring_mode: 'upper_bound',
          normal_max: normalMax,
          warning_max: warningMax,
          gold_mean: mean,
          gold_std: std,
          unit: meta.unit,
          description: meta.description,
          direction: meta.direction,
        };
        return;
      }

      validRange = [round4(mean - safeSigma * safeStd), round4(mean + safeSigma * safeStd)];
      warningRange = [round4(mean - safeSigma * 1.5 * safeStd), round4(mean + safeSigma * 1.5 * safeStd)];
      thresholdConfig[featureCode] = {
        valid_range: validRange,
        warning_range: warningRange,
        scoring_mode: 'two_sided',
        gold_mean: mean,
        gold_std: std,
        unit: meta.unit,
        description: meta.description,
        direction: meta.direction,
      };
    });

    return thresholdConfig;
  }

  async listThresholds(): Promise<ThresholdConfigDto[]> {
    const rows = await this.prisma.standardActionTemplate.findMany({
      where: { status: 1 },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    if (!rows.length) {
      return [
        {
          actionType: 'abdominal_crunch',
          version: 'v1',
          thresholdConfig: {
            confidenceMin: 0.6,
            sigmaMultiplier: 1.5,
          },
        },
      ];
    }

    return rows.map((row) => ({
      actionType: row.action_type as ThresholdConfigDto['actionType'],
      version: row.version,
      thresholdConfig: (row.threshold_config as Record<string, unknown>) || {},
    }));
  }

  async updateThreshold(actionType: string, payload: Record<string, unknown>) {
    const thresholdConfig = (payload.thresholdConfig as Record<string, unknown> | undefined) || payload;
    return this.createThresholdVersion({ actionType: this.ensureActionType(actionType), thresholdConfig, activate: true }, 'admin');
  }

  async createThresholdVersion(payload: CreateThresholdVersionPayload, operator: string) {
    const actionType = this.ensureActionType(payload.actionType);
    const active = await this.prisma.standardActionTemplate.findFirst({
      where: { action_type: actionType, status: 1 },
      orderBy: { created_at: 'desc' },
    });
    const parent = payload.parentTemplateId
      ? await this.prisma.standardActionTemplate.findUnique({ where: { template_id: BigInt(payload.parentTemplateId) } })
      : active;
    if (!parent || parent.action_type !== actionType || parent.status === 2) {
      throw new BadRequestException('请选择同一动作且未归档的版本作为调优基准');
    }

    const changeDiff = this.buildChangeDiff(
      (parent.threshold_config as Record<string, unknown>) || {},
      payload.thresholdConfig,
    );
    const activate = payload.activate !== false;
    const row = await this.prisma.$transaction(async (tx) => {
      if (activate) {
        await tx.standardActionTemplate.updateMany({
          where: { action_type: actionType, status: 1 },
          data: { status: 0 },
        });
      }
      return tx.standardActionTemplate.create({
        data: {
          action_type: actionType,
          version: this.buildThresholdVersionName(actionType),
          description: payload.changeSummary || '基于当前金标准版本调整阈值',
          reference_stats: parent.reference_stats || {},
          threshold_config: payload.thresholdConfig as Prisma.InputJsonValue,
          status: activate ? 1 : 0,
          version_type: 'threshold_tuning',
          parent_template_id: parent.template_id,
          change_summary: payload.changeSummary || '阈值参数调优',
          change_diff: changeDiff as Prisma.InputJsonValue,
          ever_activated: activate,
          created_by: operator,
        },
      });
    });
    return normalizeTemplateVersionView(row);
  }

  async listGoldTemplateSourceVideos(actionType?: string): Promise<{ items: GoldTemplateSourceVideo[] }> {
    const whereClause: Prisma.TrainingVideoWhereInput = {
      analysis_status: 'completed',
      source_type: 'gold_template',
    };

    if (actionType) {
      whereClause.action_type = this.ensureActionType(actionType);
    }

    const rows = await this.prisma.trainingVideo.findMany({
      where: whereClause,
      include: {
        video_evaluation_result: true,
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    return {
      items: rows.map((row) => ({
        videoId: Number(row.video_id),
        actionType: row.action_type as TrainingActionType,
        status: (row.analysis_status as AnalysisStatus) || 'completed',
        uploadedAt: row.created_at.toISOString(),
        duration: row.duration ?? undefined,
        averageScore: row.video_evaluation_result?.average_score ?? undefined,
        grade: row.video_evaluation_result?.grade ?? undefined,
      })),
    };
  }

  async generateGoldTemplate(payload: GoldTemplateGeneratePayload): Promise<GoldTemplateGenerateResult> {
    const actionType = this.ensureActionType(payload.actionType);
    if (!Number.isFinite(payload.sourceVideoId) || payload.sourceVideoId <= 0) {
      throw new BadRequestException('sourceVideoId 无效');
    }

    const video = await this.prisma.trainingVideo.findUnique({
      where: { video_id: BigInt(payload.sourceVideoId) },
      include: {
        motion_feature_results: true,
        rep_evaluation_results: true,
        video_evaluation_result: true,
      },
    });

    if (!video) {
      throw new NotFoundException(`未找到视频: ${payload.sourceVideoId}`);
    }

    if (video.analysis_status !== 'completed') {
      throw new BadRequestException('该视频尚未完成分析，无法提取金标准');
    }
    if (video.source_type !== 'gold_template') {
      throw new BadRequestException('仅金标准内部样本可用于提取模板');
    }

    if ((video.action_type as TrainingActionType) !== actionType) {
      throw new BadRequestException(`视频动作类型为 ${video.action_type}，与当前选择 ${actionType} 不一致`);
    }

    const featureValues: Record<string, number[]> = {};
    video.motion_feature_results.forEach((item) => {
      if (item.rep_id == null || typeof item.feature_value !== 'number') {
        return;
      }
      if (!Number.isFinite(item.feature_value)) {
        return;
      }
      if (!featureValues[item.feature_code]) {
        featureValues[item.feature_code] = [];
      }
      featureValues[item.feature_code].push(item.feature_value);
    });

    const featureCodes = Object.keys(featureValues);
    if (!featureCodes.length) {
      throw new BadRequestException('该视频缺少可用于提模的动作特征数据');
    }

    const referenceStats: Record<string, GoldFeatureStats> = {};
    featureCodes.forEach((code) => {
      const values = featureValues[code] || [];
      if (values.length > 0) {
        referenceStats[code] = this.buildFeatureStats(values);
      }
    });

    const sigmaMultiplier =
      typeof payload.sigmaMultiplier === 'number' && Number.isFinite(payload.sigmaMultiplier)
        ? payload.sigmaMultiplier
        : 2;
    const thresholdConfig = this.buildThresholdConfig(actionType, referenceStats, sigmaMultiplier);

    const totalCyclesFromRep = video.rep_evaluation_results.length;
    const validCyclesFromRep = video.rep_evaluation_results.filter((item) => item.valid_flag).length;
    const totalCyclesFromVideoEval = video.video_evaluation_result?.total_reps;
    const validCyclesFromVideoEval = video.video_evaluation_result?.valid_reps;
    const totalCyclesFromFeatures = new Set(
      video.motion_feature_results.map((item) => item.rep_id).filter((id): id is number => id != null),
    ).size;

    const totalCycles =
      totalCyclesFromRep > 0
        ? totalCyclesFromRep
        : (totalCyclesFromVideoEval ?? totalCyclesFromFeatures);

    const validCycles =
      totalCyclesFromRep > 0
        ? validCyclesFromRep
        : (validCyclesFromVideoEval ?? totalCyclesFromFeatures);

    const validCycleSource =
      totalCyclesFromRep > 0
        ? 'rep_evaluation_results'
        : (typeof totalCyclesFromVideoEval === 'number'
            ? 'video_evaluation_result'
            : 'motion_feature_results');

    const qualityReport = {
      avgConfidence:
        typeof video.quality_score === 'number' ? round4(video.quality_score / 100) : undefined,
      missingRate: undefined as number | undefined,
      totalFrames: undefined as number | undefined,
      totalCycles,
      validCycles,
      invalidCycles: Math.max(0, totalCycles - validCycles),
      validCycleSource,
      qualityPass: video.quality_status ? video.quality_status !== 'insufficient' : undefined,
      warnings: video.fail_reason ? [video.fail_reason] : [],
    };

    const latestActive = await this.prisma.standardActionTemplate.findFirst({
      where: {
        action_type: actionType,
        status: 1,
      },
      orderBy: { created_at: 'desc' },
    });

    let compareSummary: Record<string, unknown> | undefined;
    if (latestActive?.reference_stats && typeof latestActive.reference_stats === 'object') {
      const baseStats = latestActive.reference_stats as Record<string, { mean?: number; std?: number }>;
      const metricDiffs: Record<string, unknown> = {};
      Object.entries(referenceStats).forEach(([featureCode, stats]) => {
        const base = baseStats[featureCode];
        if (!base || typeof base.mean !== 'number' || typeof base.std !== 'number') {
          return;
        }
        metricDiffs[featureCode] = {
          baseMean: base.mean,
          newMean: stats.mean,
          deltaMean: round4(stats.mean - base.mean),
          baseStd: base.std,
          newStd: stats.std,
          deltaStd: round4(stats.std - base.std),
        };
      });
      compareSummary = {
        baseVersion: latestActive.version,
        metricDiffs,
      };
    }

    return {
      actionType,
      sourceVideoId: payload.sourceVideoId,
      sourceVideoKey: payload.sourceVideoKey || video.video_key || undefined,
      sourceVideoName: payload.sourceVideoName,
      qualityReport,
      referenceStats,
      thresholdConfig,
      compareSummary,
      generatedAt: new Date().toISOString(),
    };
  }

  async saveGoldTemplateVersion(payload: SaveGoldTemplatePayload, operator: string) {
    const actionType = this.ensureActionType(payload.actionType);
    const version = String(payload.version || '').trim();
    if (!version) {
      throw new BadRequestException('版本号不能为空');
    }

    const row = await this.prisma.standardActionTemplate.create({
      data: {
        action_type: actionType,
        version,
        description: payload.description || null,
        reference_stats: payload.referenceStats as Prisma.InputJsonValue,
        threshold_config: payload.thresholdConfig as Prisma.InputJsonValue,
        status: 0,
        version_type: 'gold_template',
        ever_activated: false,
        created_by: operator,
      },
    });

    return {
      templateId: Number(row.template_id),
      actionType: row.action_type as TrainingActionType,
      version: row.version,
      createdAt: row.created_at.toISOString(),
    };
  }

  async listGoldTemplateVersions(query?: { actionType?: string; status?: number; page?: number; pageSize?: number }) {
    const whereClause: Prisma.StandardActionTemplateWhereInput = {};
    if (query?.actionType) {
      whereClause.action_type = this.ensureActionType(query.actionType);
    }
    if (typeof query?.status === 'number' && Number.isFinite(query.status)) {
      whereClause.status = query.status;
    }

    const page = Math.max(Math.floor(query?.page || 1), 1);
    const pageSize = Math.min(Math.max(Math.floor(query?.pageSize || 10), 1), 100);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.standardActionTemplate.count({ where: whereClause }),
      this.prisma.standardActionTemplate.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => normalizeTemplateVersionView(row)),
      total,
      page,
      pageSize,
    };
  }

  async getGoldTemplateVersion(templateId: number) {
    if (!Number.isFinite(templateId) || templateId <= 0) throw new BadRequestException('templateId 无效');
    const row = await this.prisma.standardActionTemplate.findUnique({ where: { template_id: BigInt(templateId) } });
    if (!row) throw new NotFoundException(`模板不存在: ${templateId}`);
    return normalizeTemplateVersionView(row);
  }

  async archiveGoldTemplateVersion(templateId: number) {
    const target = await this.prisma.standardActionTemplate.findUnique({ where: { template_id: BigInt(templateId) } });
    if (!target) throw new NotFoundException(`模板不存在: ${templateId}`);
    if (target.status === 1) throw new BadRequestException('当前启用版本不能归档，请先启用替代版本');
    const updated = await this.prisma.standardActionTemplate.update({
      where: { template_id: BigInt(templateId) },
      data: { status: 2 },
    });
    return { templateId, status: updated.status };
  }

  async deleteGoldTemplateVersion(templateId: number) {
    const target = await this.prisma.standardActionTemplate.findUnique({ where: { template_id: BigInt(templateId) } });
    if (!target) throw new NotFoundException(`模板不存在: ${templateId}`);
    if (target.status === 1 || target.ever_activated) {
      throw new BadRequestException('已启用或曾启用的版本不可删除，请使用归档保留追溯记录');
    }
    const childCount = await this.prisma.standardActionTemplate.count({ where: { parent_template_id: BigInt(templateId) } });
    if (childCount > 0) throw new BadRequestException('该版本已有派生版本，不能删除；请使用归档');
    await this.prisma.standardActionTemplate.delete({ where: { template_id: BigInt(templateId) } });
    return { templateId, deleted: true };
  }

  async updateGoldTemplateVersionStatus(templateId: number, status: number) {
    if (!Number.isFinite(templateId) || templateId <= 0) {
      throw new BadRequestException('templateId 无效');
    }

    const target = await this.prisma.standardActionTemplate.findUnique({
      where: { template_id: BigInt(templateId) },
    });
    if (!target) {
      throw new NotFoundException(`模板不存在: ${templateId}`);
    }

    if (target.status === 2) {
      throw new BadRequestException('已归档版本不能再修改状态');
    }
    const normalizedStatus = status === 1 ? 1 : 0;

    if (normalizedStatus === 1) {
      await this.prisma.$transaction([
        this.prisma.standardActionTemplate.updateMany({
          where: {
            action_type: target.action_type,
            template_id: { not: BigInt(templateId) },
          },
          data: { status: 0 },
        }),
        this.prisma.standardActionTemplate.update({
          where: { template_id: BigInt(templateId) },
          data: { status: 1, ever_activated: true },
        }),
      ]);
    } else {
      const activeCount = await this.prisma.standardActionTemplate.count({
        where: { action_type: target.action_type, status: 1 },
      });
      if (target.status === 1 && activeCount <= 1) {
        throw new BadRequestException('每个动作必须保留一个当前生效版本；请先启用替代版本');
      }
      await this.prisma.standardActionTemplate.update({
        where: { template_id: BigInt(templateId) },
        data: { status: 0 },
      });
    }

    const updated = await this.prisma.standardActionTemplate.findUnique({
      where: { template_id: BigInt(templateId) },
    });

    return {
      templateId,
      status: updated?.status ?? normalizedStatus,
    };
  }

  private buildThresholdVersionName(actionType: TrainingActionType) {
    const prefix: Record<TrainingActionType, string> = {
      abdominal_crunch: '缩腹',
      pelvic_tilt: '骨盆倾斜',
      knee_rotation: '膝关节旋转',
    };
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('');
    const time = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0'), String(now.getSeconds()).padStart(2, '0')].join('');
    return `${prefix[actionType]}-${stamp}-${time}`;
  }

  private buildChangeDiff(previous: Record<string, unknown>, next: Record<string, unknown>) {
    const diff: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    keys.forEach((key) => {
      const before = previous[key];
      const after = next[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) diff[key] = { before, after };
    });
    return diff;
  }

  async getMotivationRules(): Promise<MotivationRulesDto> {
    const row = await this.prisma.systemConfig.findUnique({ where: { config_key: 'motivation_rules' } });
    const raw = (row?.config_value || {}) as Partial<MotivationRulesDto>;
    const numberValue = (value: unknown, fallback: number, min: number, max: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    const slightScore = numberValue(raw.scoreSlightDelta, DEFAULT_MOTIVATION_RULES.scoreSlightDelta, 1, 30);
    const slightStability = numberValue(raw.stabilitySlightDelta, DEFAULT_MOTIVATION_RULES.stabilitySlightDelta, 1, 30);
    const slightDuration = numberValue(raw.durationSlightDelta, DEFAULT_MOTIVATION_RULES.durationSlightDelta, 0.1, 30);
    const slightReps = numberValue(raw.repsSlightDelta, DEFAULT_MOTIVATION_RULES.repsSlightDelta, 1, 20);
    return {
      scoreSlightDelta: slightScore,
      scoreClearDelta: Math.max(slightScore, numberValue(raw.scoreClearDelta, DEFAULT_MOTIVATION_RULES.scoreClearDelta, 1, 50)),
      stabilitySlightDelta: slightStability,
      stabilityClearDelta: Math.max(slightStability, numberValue(raw.stabilityClearDelta, DEFAULT_MOTIVATION_RULES.stabilityClearDelta, 1, 50)),
      durationSlightDelta: slightDuration,
      durationClearDelta: Math.max(slightDuration, numberValue(raw.durationClearDelta, DEFAULT_MOTIVATION_RULES.durationClearDelta, 0.1, 60)),
      repsSlightDelta: slightReps,
      repsClearDelta: Math.max(slightReps, numberValue(raw.repsClearDelta, DEFAULT_MOTIVATION_RULES.repsClearDelta, 1, 50)),
    };
  }

  async updateMotivationRules(payload: Partial<MotivationRulesDto>): Promise<MotivationRulesDto> {
    const current = await this.getMotivationRules();
    const next = await this.normalizeMotivationRules({ ...current, ...payload });
    await this.prisma.systemConfig.upsert({
      where: { config_key: 'motivation_rules' },
      update: { config_value: next as unknown as Prisma.InputJsonValue },
      create: { config_key: 'motivation_rules', config_value: next as unknown as Prisma.InputJsonValue, description: '激励机制进步提示阈值配置' },
    });
    return next;
  }

  private async normalizeMotivationRules(payload: Partial<MotivationRulesDto>) {
    return this.getMotivationRulesFromPayload(payload);
  }

  private getMotivationRulesFromPayload(payload: Partial<MotivationRulesDto>): MotivationRulesDto {
    const base = DEFAULT_MOTIVATION_RULES;
    const clamp = (value: unknown, fallback: number, min: number, max: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    const scoreSlightDelta = clamp(payload.scoreSlightDelta, base.scoreSlightDelta, 1, 30);
    const stabilitySlightDelta = clamp(payload.stabilitySlightDelta, base.stabilitySlightDelta, 1, 30);
    const durationSlightDelta = clamp(payload.durationSlightDelta, base.durationSlightDelta, 0.1, 30);
    const repsSlightDelta = clamp(payload.repsSlightDelta, base.repsSlightDelta, 1, 20);
    return {
      scoreSlightDelta,
      scoreClearDelta: Math.max(scoreSlightDelta, clamp(payload.scoreClearDelta, base.scoreClearDelta, 1, 50)),
      stabilitySlightDelta,
      stabilityClearDelta: Math.max(stabilitySlightDelta, clamp(payload.stabilityClearDelta, base.stabilityClearDelta, 1, 50)),
      durationSlightDelta,
      durationClearDelta: Math.max(durationSlightDelta, clamp(payload.durationClearDelta, base.durationClearDelta, 0.1, 60)),
      repsSlightDelta,
      repsClearDelta: Math.max(repsSlightDelta, clamp(payload.repsClearDelta, base.repsClearDelta, 1, 50)),
    };
  }

  async getPatientAppConfig(forceRefresh = false): Promise<PatientAppConfigDto> {
    if (!forceRefresh) {
      const cached = this.readCachedPatientAppConfig();
      if (cached) {
        return cached;
      }
    }

    const row = await this.prisma.systemConfig.findUnique({
      where: { config_key: 'patient_app_config' },
    });

    const config = !row
      ? { ...DEFAULT_APP_CONFIG }
      : normalizePatientAppConfig(row.config_value as Partial<PatientAppConfigDto>);

    this.writePatientAppConfigCache(config);
    return config;
  }

  async updatePatientAppConfig(payload: UpdatePatientAppConfigRequestDto): Promise<PatientAppConfigDto> {
    const current = await this.getPatientAppConfig(true);
    const merged = normalizePatientAppConfig({
      videoMinDurationSeconds: payload.videoMinDurationSeconds ?? current.videoMinDurationSeconds,
    videoMaxDurationSeconds: payload.videoMaxDurationSeconds ?? current.videoMaxDurationSeconds,
      videoRecordMaxDurationSeconds:
        payload.videoRecordMaxDurationSeconds ?? current.videoRecordMaxDurationSeconds,
      videoMaxSizeMB: payload.videoMaxSizeMB ?? current.videoMaxSizeMB,
      weeklyTarget: payload.weeklyTarget ?? current.weeklyTarget,
      analyzingMinWaitSeconds: payload.analyzingMinWaitSeconds ?? current.analyzingMinWaitSeconds,
      supportedActionTypes: payload.supportedActionTypes ?? current.supportedActionTypes,
    });

    await this.prisma.systemConfig.upsert({
      where: { config_key: 'patient_app_config' },
      update: {
        config_value: merged as unknown as Prisma.InputJsonValue,
      },
      create: {
        config_key: 'patient_app_config',
        config_value: merged as unknown as Prisma.InputJsonValue,
        description: '患者端应用配置：视频限制、周目标、分析等待时长等',
      },
    });

    this.writePatientAppConfigCache(merged);
    return merged;
  }
}
