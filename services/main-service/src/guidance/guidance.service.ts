import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminGuidanceListItemDto,
  AssetUploadTargetDto,
  CommonMistakeDto,
  GuidanceAssetDto,
  GuidanceContentDto,
  GuidanceListItemDto,
  GuidanceValidationResultDto,
  GuidanceStepDto,
  ShootingRequirementDto,
} from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';
import { StorageService, type UploadedBinaryFile } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

type GuidanceConfigPackageItem = {
  actionType: TrainingActionType;
  title: string;
  snapshot: Record<string, unknown>;
};

type GuidanceConfigPackage = {
  format: 'home-rehab-motion.guidance-config';
  version: 1;
  exportedAt: string;
  items: GuidanceConfigPackageItem[];
};

type GuidanceRecord = {
  content_id: bigint;
  action_type: string;
  title: string;
  status: number;
  version: number;
  published_version: number | null;
  draft_snapshot: unknown;
  updated_at: Date;
};

const ACTION_TYPES: TrainingActionType[] = ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'];
const SHOOTING_TYPES = ['angle', 'framing', 'lighting', 'stability'] as const;

function asText(value: unknown, maxLength = 2000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toAsset(value: unknown): GuidanceAssetDto | undefined {
  if (typeof value === 'string' && value.trim()) return { url: value.trim() };
  if (!isRecord(value) || !asText(value.url, 1024)) return undefined;
  return {
    objectKey: asText(value.objectKey, 255) || undefined,
    url: asText(value.url, 1024),
    thumbnailUrl: asText(value.thumbnailUrl, 1024) || undefined,
    mimeType: asText(value.mimeType, 100) || undefined,
    sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
    width: typeof value.width === 'number' ? value.width : undefined,
    height: typeof value.height === 'number' ? value.height : undefined,
    durationSeconds: typeof value.durationSeconds === 'number' ? value.durationSeconds : undefined,
  };
}

function toSteps(value: unknown): GuidanceStepDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    return [{
      id: asText(item.id, 80) || `step-${index + 1}`,
      order: typeof item.order === 'number' ? item.order : index + 1,
      title: asText(item.title, 16),
      description: asText(item.description, 35),
      image: toAsset(item.image),
      altText: asText(item.altText, 120),
    }];
  }).sort((a, b) => a.order - b.order);
}

function toShootingRequirements(value: unknown): ShootingRequirementDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const type = asText(item.type, 30);
    if (!SHOOTING_TYPES.includes(type as (typeof SHOOTING_TYPES)[number])) return [];
    return [{
      id: asText(item.id, 80) || `shooting-${index + 1}`,
      type: type as ShootingRequirementDto['type'],
      title: asText(item.title, 30),
      description: asText(item.description, 80),
      correctImage: toAsset(item.correctImage) || { url: '' },
      incorrectImage: toAsset(item.incorrectImage),
      altText: asText(item.altText, 120),
    }];
  });
}

function toCommonMistakes(value: unknown): CommonMistakeDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const title = asText(item.title, 30);
    const mistakeDescription = asText(item.mistakeDescription, 120);
    const correction = asText(item.correction, 120);
    const media = toAsset(item.media);
    const correctImage = toAsset(item.correctImage);
    return [{
      id: asText(item.id, 80) || `mistake-${index + 1}`,
      order: typeof item.order === 'number' ? item.order : index + 1,
      title,
      mistakeDescription,
      correction,
      media,
      correctImage,
    }];
  }).sort((a, b) => a.order - b.order);
}

function normalizeSnapshot(payload: Record<string, unknown>, contentId: number, actionType: TrainingActionType): GuidanceContentDto {
  const videoInput = isRecord(payload.video) ? payload.video : {};
  return {
    contentId,
    actionType,
    title: asText(payload.title, 30),
    briefInstruction: asText(payload.briefInstruction, 40),
    estimatedMinutes: Math.max(0, Math.min(180, Number(payload.estimatedMinutes) || 0)),
    coverImage: toAsset(payload.coverImage) || { url: '' },
    trainingSafetyNotice: asText(payload.trainingSafetyNotice, 500),
    video: {
      asset: toAsset(videoInput.asset) || { url: '' },
      fallbackText: asText(videoInput.fallbackText, 200),
    },
    steps: toSteps(payload.steps),
    shootingRequirements: toShootingRequirements(payload.shootingRequirements),
    commonMistakes: toCommonMistakes(payload.commonMistakes),
  };
}

function normalizeStoredSnapshot(value: unknown, contentId: number, actionType: TrainingActionType): GuidanceContentDto {
  return normalizeSnapshot(isRecord(value) ? value : {}, contentId, actionType);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validateSnapshot(snapshot: GuidanceContentDto): GuidanceValidationResultDto {
  const errors: string[] = [];
  if (!snapshot.title) errors.push('请填写标题（不超过 30 字）');
  if (!snapshot.briefInstruction) errors.push('请填写一句话目标（不超过 40 字）');
  if (!snapshot.estimatedMinutes) errors.push('请填写预计训练时长');
  if (!snapshot.coverImage?.url) errors.push('请上传封面图');
  if (!snapshot.trainingSafetyNotice) errors.push('请填写训练前安全提示');
  if (!snapshot.video.asset?.url) errors.push('请上传教学视频');
  if (snapshot.steps.length < 3 || snapshot.steps.length > 5) errors.push('动作步骤需为 3 至 5 步');
  snapshot.steps.forEach((step, index) => {
    if (!step.title) errors.push(`请填写步骤 ${index + 1} 的标题`);
  });
  const requiredShootingTypes = ['angle', 'framing', 'lighting'];
  if (snapshot.shootingRequirements.length < 3) errors.push('拍摄要求至少需要 3 条');
  requiredShootingTypes.forEach((type) => {
    if (!snapshot.shootingRequirements.some((item) => item.type === type)) errors.push(`拍摄要求缺少${type === 'angle' ? '拍摄角度' : type === 'framing' ? '入镜范围' : '光线'}说明`);
  });
  snapshot.shootingRequirements.forEach((item, index) => {
    if (!item.title || !item.description || !item.correctImage?.url) errors.push(`拍摄要求 ${index + 1} 的标题、患者短说明和正确示意图必须完整`);
  });
  snapshot.commonMistakes.forEach((item, index) => {
    if (!item.title || !item.mistakeDescription || !item.correction || (!item.media?.url && !item.correctImage?.url)) errors.push(`常见错误 ${index + 1} 需包含错误说明、正确做法和至少一张示意图`);
  });
  return { valid: errors.length === 0, errors };
}

function toListItem(snapshot: GuidanceContentDto): GuidanceListItemDto {
  return {
    contentId: snapshot.contentId,
    actionType: snapshot.actionType,
    title: snapshot.title,
    briefInstruction: snapshot.briefInstruction,
    estimatedMinutes: snapshot.estimatedMinutes,
    coverImage: snapshot.coverImage,
    version: snapshot.version,
  };
}

@Injectable()
export class GuidanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async findContent(id: number): Promise<GuidanceRecord> {
    const content = await this.prisma.guidanceContent.findUnique({ where: { content_id: BigInt(id) } });
    if (!content) throw new NotFoundException(`指导内容不存在: ${id}`);
    return content as GuidanceRecord;
  }

  async getGuidanceDetailByAction(actionTypeInput: string): Promise<GuidanceContentDto> {
    const actionType = asText(actionTypeInput, 30) as TrainingActionType;
    if (!ACTION_TYPES.includes(actionType)) throw new BadRequestException('不支持的动作类型');
    const contents = await this.prisma.guidanceContent.findMany({
      where: { action_type: actionType, status: 1, published_version: { not: null } },
      orderBy: { updated_at: 'desc' },
      take: 2,
    });
    const content = contents[0];
    if (!content) throw new NotFoundException('当前动作暂未上架指导内容');
    if (contents.length > 1) {
      await this.prisma.guidanceContent.updateMany({ where: { content_id: { in: contents.slice(1).map((item) => item.content_id) } }, data: { status: 0 } });
    }
    return this.getGuidanceDetail(Number(content.content_id));
  }

  async getGuidanceDetail(contentId: number): Promise<GuidanceContentDto> {
    const content = await this.findContent(contentId);
    if (!content.published_version) throw new NotFoundException('当前动作指导暂未准备好');
    const published = await this.prisma.guidanceContentVersion.findUnique({
      where: { content_id_version: { content_id: BigInt(contentId), version: content.published_version } },
    });
    if (!published?.snapshot) throw new NotFoundException('当前动作指导暂未准备好');
    const snapshot = normalizeStoredSnapshot(published.snapshot, contentId, content.action_type as TrainingActionType);
    return { ...this.withAccessibleAssetUrls(snapshot), version: content.published_version };
  }

  async listPatientGuidance(): Promise<GuidanceListItemDto[]> {
    const contents = await this.prisma.guidanceContent.findMany({
      where: { status: 1, published_version: { not: null } },
      orderBy: { updated_at: 'desc' },
      take: 20,
    });
    const result = await Promise.all(contents.map(async (content) => {
      const snapshot = await this.getGuidanceDetail(Number(content.content_id));
      return toListItem(snapshot);
    }));
    return result;
  }

  async listAdminGuidance(): Promise<AdminGuidanceListItemDto[]> {
    const list = await this.prisma.guidanceContent.findMany({ orderBy: { updated_at: 'desc' }, take: 100 });
    // 兼容历史数据：同一动作曾被错误地标记为多条启用时，仅保留最新一条为启用态。
    const activeIdByAction = new Map<string, bigint>();
    list.filter((item) => item.status === 1).forEach((item) => {
      if (!activeIdByAction.has(item.action_type)) activeIdByAction.set(item.action_type, item.content_id);
    });
    const invalidActiveIds = list.filter((item) => item.status === 1 && activeIdByAction.get(item.action_type) !== item.content_id).map((item) => item.content_id);
    if (invalidActiveIds.length) {
      await this.prisma.guidanceContent.updateMany({ where: { content_id: { in: invalidActiveIds } }, data: { status: 0 } });
    }
    return list.map((item) => ({
      contentId: Number(item.content_id),
      actionType: item.action_type as TrainingActionType,
      title: item.title,
      enabled: item.status === 1 && activeIdByAction.get(item.action_type) === item.content_id,
      updatedAt: item.updated_at.toISOString(),
    }));
  }

  async createAdminGuidance(payload: Record<string, unknown>) {
    const actionType = asText(payload.actionType, 30) as TrainingActionType;
    if (!ACTION_TYPES.includes(actionType)) throw new BadRequestException('请选择有效的动作类型');
    const snapshot = normalizeSnapshot(payload, 0, actionType);
    const validation = validateSnapshot(snapshot);
    if (!validation.valid) throw new BadRequestException({ message: '请补充完整内容后再保存', errors: validation.errors });
    const created = await this.prisma.guidanceContent.create({
      data: {
        action_type: actionType,
        title: snapshot.title || '未命名指导内容',
        status: 0,
        version: 1,
        published_version: 1,
        draft_snapshot: toJson(snapshot),
      },
    });
    const result = { ...snapshot, contentId: Number(created.content_id), version: 1 };
    await this.prisma.guidanceContentVersion.create({ data: { content_id: created.content_id, version: 1, snapshot: toJson(result) } });
    return result;
  }

  async exportGuidanceConfigPackage(): Promise<GuidanceConfigPackage> {
    const contents = await this.prisma.guidanceContent.findMany({
      where: { action_type: { in: ACTION_TYPES } },
      orderBy: [{ status: 'desc' }, { updated_at: 'desc' }],
    });
    const selectedByAction = new Map<TrainingActionType, GuidanceRecord>();
    for (const content of contents as GuidanceRecord[]) {
      const actionType = content.action_type as TrainingActionType;
      if (!selectedByAction.has(actionType)) selectedByAction.set(actionType, content);
    }

    const items: GuidanceConfigPackageItem[] = [];
    for (const actionType of ACTION_TYPES) {
      const content = selectedByAction.get(actionType);
      if (!content?.published_version) continue;
      const version = await this.prisma.guidanceContentVersion.findUnique({
        where: { content_id_version: { content_id: content.content_id, version: content.published_version } },
      });
      if (!isRecord(version?.snapshot)) continue;
      const { contentId: _contentId, version: _version, ...snapshot } = version.snapshot;
      items.push({ actionType, title: content.title, snapshot });
    }

    return { format: 'home-rehab-motion.guidance-config', version: 1, exportedAt: new Date().toISOString(), items };
  }

  async importGuidanceConfigPackage(payload: unknown) {
    if (!isRecord(payload) || payload.format !== 'home-rehab-motion.guidance-config' || payload.version !== 1 || !Array.isArray(payload.items)) {
      throw new BadRequestException('指导内容配置包格式无效');
    }
    const imported: string[] = [];
    const skipped: string[] = [];
    const invalid: string[] = [];
    const seenActionTypes = new Set<TrainingActionType>();

    for (const item of payload.items) {
      if (!isRecord(item)) { invalid.push('存在无效配置项'); continue; }
      const actionType = asText(item.actionType, 30) as TrainingActionType;
      if (!ACTION_TYPES.includes(actionType) || seenActionTypes.has(actionType) || !isRecord(item.snapshot)) {
        invalid.push(asText(item.title, 30) || actionType || '未知动作');
        continue;
      }
      seenActionTypes.add(actionType);
      const exists = await this.prisma.guidanceContent.count({ where: { action_type: actionType } });
      if (exists) { skipped.push(actionType); continue; }
      const snapshot = normalizeSnapshot(item.snapshot, 0, actionType);
      const validation = validateSnapshot(snapshot);
      if (!validation.valid) { invalid.push(`${actionType}（${validation.errors.join('、')}）`); continue; }
      const created = await this.prisma.guidanceContent.create({
        data: {
          action_type: actionType,
          title: snapshot.title,
          status: 0,
          version: 1,
          published_version: 1,
          draft_snapshot: toJson(snapshot),
        },
      });
      const storedSnapshot = { ...snapshot, contentId: Number(created.content_id), version: 1 };
      await this.prisma.guidanceContentVersion.create({
        data: { content_id: created.content_id, version: 1, snapshot: toJson(storedSnapshot) },
      });
      imported.push(actionType);
    }
    return { imported, skipped, invalid };
  }

  async getAdminGuidance(id: number): Promise<GuidanceContentDto> {
    const content = await this.findContent(id);
    if (!content.published_version) throw new NotFoundException('指导内容数据不完整');
    const version = await this.prisma.guidanceContentVersion.findUnique({
      where: { content_id_version: { content_id: BigInt(id), version: content.published_version } },
    });
    if (!version?.snapshot) throw new NotFoundException('指导内容数据不完整');
    const snapshot = normalizeStoredSnapshot(version.snapshot, id, content.action_type as TrainingActionType);
    return { ...this.withAccessibleAssetUrls(snapshot), version: content.published_version };
  }

  async updateAdminGuidance(id: number, payload: Record<string, unknown>) {
    const current = await this.findContent(id);
    const snapshot = normalizeSnapshot(payload, id, current.action_type as TrainingActionType);
    const validation = validateSnapshot(snapshot);
    if (!validation.valid) throw new BadRequestException({ message: '请补充完整内容后再保存', errors: validation.errors });
    const nextVersion = Math.max(1, current.version + 1);
    const storedSnapshot = { ...snapshot, version: nextVersion };
    await this.prisma.$transaction([
      this.prisma.guidanceContentVersion.create({ data: { content_id: BigInt(id), version: nextVersion, snapshot: toJson(storedSnapshot) } }),
      this.prisma.guidanceContent.update({
        where: { content_id: BigInt(id) },
        data: { title: storedSnapshot.title || current.title, version: nextVersion, published_version: nextVersion, draft_snapshot: toJson(storedSnapshot) },
      }),
    ]);
    return storedSnapshot;
  }

  async setAdminGuidanceEnabled(id: number, enabled: boolean) {
    const content = await this.findContent(id);
    if (!enabled) {
      await this.prisma.guidanceContent.update({ where: { content_id: BigInt(id) }, data: { status: 0 } });
      return { contentId: id, enabled: false };
    }
    if (!content.published_version) throw new BadRequestException('内容不完整，无法启用');
    await this.prisma.$transaction([
      this.prisma.guidanceContent.updateMany({ where: { action_type: content.action_type, status: 1 }, data: { status: 0 } }),
      this.prisma.guidanceContent.update({ where: { content_id: BigInt(id) }, data: { status: 1 } }),
    ]);
    return { contentId: id, enabled: true };
  }

  async copyAdminGuidance(id: number) {
    const source = await this.findContent(id);
    const snapshot = await this.getAdminGuidance(id);
    const copiedTitle = `${snapshot.title}（副本）`.slice(0, 30);
    const copySnapshot = { ...snapshot, contentId: 0, title: copiedTitle, version: 1 };
    const created = await this.prisma.guidanceContent.create({
      data: { action_type: source.action_type, title: copiedTitle, status: 0, version: 1, published_version: 1, draft_snapshot: toJson(copySnapshot) },
    });
    const result = { ...copySnapshot, contentId: Number(created.content_id) };
    await this.prisma.guidanceContentVersion.create({ data: { content_id: created.content_id, version: 1, snapshot: toJson(result) } });
    return result;
  }

  async deleteAdminGuidance(id: number): Promise<void> {
    const content = await this.findContent(id);
    try {
      await this.prisma.$transaction([
        this.prisma.guidanceContentVersion.deleteMany({ where: { content_id: content.content_id } }),
        this.prisma.guidanceContent.delete({ where: { content_id: content.content_id } }),
      ]);
    } catch (error: any) {
      if (error?.code === 'P2003') {
        throw new BadRequestException('该指导内容仍被关联数据引用，暂时无法删除，请先下线保留记录');
      }
      throw error;
    }
  }

  private withAccessibleAssetUrls(snapshot: GuidanceContentDto): GuidanceContentDto {
    const resolveAsset = (asset?: GuidanceAssetDto): GuidanceAssetDto | undefined => {
      if (!asset?.objectKey) return asset;
      return { ...asset, url: this.storage.getPublicObjectUrl(asset.objectKey) };
    };

    return {
      ...snapshot,
      coverImage: resolveAsset(snapshot.coverImage) || snapshot.coverImage,
      video: { ...snapshot.video, asset: resolveAsset(snapshot.video.asset) || snapshot.video.asset },
      steps: snapshot.steps.map((step) => ({ ...step, image: resolveAsset(step.image) })),
      shootingRequirements: snapshot.shootingRequirements.map((item) => ({
        ...item,
        correctImage: resolveAsset(item.correctImage) || item.correctImage,
        incorrectImage: resolveAsset(item.incorrectImage),
      })),
      commonMistakes: snapshot.commonMistakes.map((item) => ({
        ...item,
        media: resolveAsset(item.media),
        correctImage: resolveAsset(item.correctImage),
      })),
    };
  }

  async getAdminPresignUpload(
    fileName?: string,
    mediaKind: 'image' | 'video' = 'image',
    contentType?: string,
  ): Promise<AssetUploadTargetDto> {
    const fallbackName = mediaKind === 'video' ? 'teaching-video.mp4' : 'asset.png';
    const objectKey = this.storage.buildGuidanceAssetObjectKey(fileName || fallbackName);
    return this.storage.createAssetUploadTarget(objectKey, mediaKind, contentType);
  }

  async uploadAsset(objectKey: string, file?: UploadedBinaryFile) {
    if (!objectKey) throw new BadRequestException('缺少对象路径');
    return this.storage.saveAssetFile(objectKey, file);
  }
}
