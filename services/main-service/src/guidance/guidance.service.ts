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
  GuidanceVersionDto,
  GuidanceStepDto,
  ShootingRequirementDto,
} from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';
import { StorageService, type UploadedBinaryFile } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';

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
    if (!item.title || !item.description || !item.correctImage?.url || !item.altText) errors.push(`拍摄要求 ${index + 1} 的文字、正确示意图和替代文本必须完整`);
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

  async getGuidanceDetail(contentId: number): Promise<GuidanceContentDto> {
    const content = await this.findContent(contentId);
    if (!content.published_version) throw new NotFoundException('当前动作指导暂未准备好');
    const published = await this.prisma.guidanceContentVersion.findUnique({
      where: { content_id_version: { content_id: BigInt(contentId), version: content.published_version } },
    });
    if (!published?.snapshot) throw new NotFoundException('当前动作指导暂未准备好');
    const snapshot = normalizeStoredSnapshot(published.snapshot, contentId, content.action_type as TrainingActionType);
    return { ...snapshot, version: content.published_version };
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
    const list = await this.prisma.guidanceContent.findMany({ orderBy: { updated_at: 'desc' }, take: 50 });
    return list.map((item) => ({
      contentId: Number(item.content_id),
      actionType: item.action_type as TrainingActionType,
      title: item.title,
      publishedVersion: item.published_version || undefined,
      hasDraft: Boolean(item.draft_snapshot),
      published: Boolean(item.published_version),
      updatedAt: item.updated_at.toISOString(),
    }));
  }

  async createAdminGuidance(payload: Record<string, unknown>) {
    const actionType = asText(payload.actionType, 30) as TrainingActionType;
    if (!ACTION_TYPES.includes(actionType)) throw new BadRequestException('请选择有效的动作类型');
    const draft = normalizeSnapshot(payload, 0, actionType);
    const created = await this.prisma.guidanceContent.create({
      data: { action_type: actionType, title: draft.title || '未命名指导内容', status: 0, version: 0, draft_snapshot: toJson(draft) },
    });
    const snapshot = { ...draft, contentId: Number(created.content_id) };
    await this.prisma.guidanceContent.update({ where: { content_id: created.content_id }, data: { draft_snapshot: toJson(snapshot) } });
    return snapshot;
  }

  async getAdminDraft(id: number): Promise<GuidanceContentDto> {
    const content = await this.findContent(id);
    const draft = normalizeStoredSnapshot(content.draft_snapshot, id, content.action_type as TrainingActionType);
    if (draft.title || content.draft_snapshot) return draft;
    if (content.published_version) return this.getGuidanceDetail(id);
    return draft;
  }

  async saveAdminDraft(id: number, payload: Record<string, unknown>) {
    const current = await this.findContent(id);
    const actionType = current.action_type as TrainingActionType;
    const draft = normalizeSnapshot(payload, id, actionType);
    await this.prisma.guidanceContent.update({
      where: { content_id: BigInt(id) },
      data: { title: draft.title || current.title, draft_snapshot: toJson(draft) },
    });
    return draft;
  }

  async validateAdminGuidance(id: number): Promise<GuidanceValidationResultDto> {
    return validateSnapshot(await this.getAdminDraft(id));
  }

  async publishAdminGuidance(id: number) {
    const current = await this.findContent(id);
    const draft = await this.getAdminDraft(id);
    const validation = validateSnapshot(draft);
    if (!validation.valid) throw new BadRequestException({ message: '发布校验未通过', errors: validation.errors });
    const nextVersion = current.version + 1;
    const snapshot = { ...draft, version: nextVersion };
    await this.prisma.$transaction([
      this.prisma.guidanceContentVersion.create({
        data: { content_id: BigInt(id), version: nextVersion, snapshot: toJson(snapshot) },
      }),
      this.prisma.guidanceContent.update({
        where: { content_id: BigInt(id) },
        data: { title: snapshot.title, status: 1, version: nextVersion, published_version: nextVersion, draft_snapshot: toJson(snapshot) },
      }),
    ]);
    return snapshot;
  }

  async updateAdminGuidance(id: number, payload: Record<string, unknown>) {
    return this.saveAdminDraft(id, payload);
  }

  async deleteAdminGuidance(id: number): Promise<void> {
    const content = await this.findContent(id);
    await this.prisma.$transaction([
      this.prisma.guidanceContentVersion.deleteMany({ where: { content_id: content.content_id } }),
      this.prisma.guidanceContent.delete({ where: { content_id: content.content_id } }),
    ]);
  }

  async getGuidanceVersions(id: number): Promise<GuidanceVersionDto[]> {
    await this.findContent(id);
    const versions = await this.prisma.guidanceContentVersion.findMany({ where: { content_id: BigInt(id) }, orderBy: { version: 'desc' }, take: 20 });
    return versions.map((item) => ({
      contentId: id,
      version: item.version,
      createdAt: item.created_at.toISOString(),
      snapshot: normalizeStoredSnapshot(item.snapshot, id, (item.snapshot as Record<string, unknown>)?.actionType as TrainingActionType || 'abdominal_crunch'),
    }));
  }

  async rollbackAdminGuidance(id: number, version: number) {
    const current = await this.findContent(id);
    const target = await this.prisma.guidanceContentVersion.findUnique({ where: { content_id_version: { content_id: BigInt(id), version } } });
    if (!target?.snapshot) throw new NotFoundException(`历史版本不存在: V${version}`);
    const draft = normalizeStoredSnapshot(target.snapshot, id, current.action_type as TrainingActionType);
    await this.prisma.guidanceContent.update({ where: { content_id: BigInt(id) }, data: { draft_snapshot: toJson(draft) } });
    return draft;
  }

  async getAdminPresignUpload(fileName?: string, mediaKind: 'image' | 'video' = 'image'): Promise<AssetUploadTargetDto> {
    const fallbackName = mediaKind === 'video' ? 'teaching-video.mp4' : 'asset.png';
    const objectKey = this.storage.buildGuidanceAssetObjectKey(fileName || fallbackName);
    return this.storage.createAssetUploadTarget(objectKey, mediaKind);
  }

  async uploadAsset(objectKey: string, file?: UploadedBinaryFile) {
    if (!objectKey) throw new BadRequestException('缺少对象路径');
    return this.storage.saveAssetFile(objectKey, file);
  }
}
