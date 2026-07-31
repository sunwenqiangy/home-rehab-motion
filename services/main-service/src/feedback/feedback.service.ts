import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdminFeedbackListItemDto,
  CreateFeedbackRequestDto,
  FeedbackDto,
  FeedbackImageUploadTargetDto,
  FeedbackMessageDto,
  FeedbackStatusLogDto,
} from '@home-rehab-motion/shared-contract';
import type { FeedbackStatus, FeedbackType } from '@home-rehab-motion/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, type UploadedBinaryFile } from '../storage/storage.service';

const SAFETY_NOTICE = '您提到训练中出现身体不适。请先暂停本次训练；若不适持续、加重或影响活动，请及时联系主治医生或前往医疗机构评估。本系统仅提供训练指导，不提供诊断、紧急医疗帮助或治疗建议。';
const MAX_IMAGE_COUNT = 3;
const MAX_CONTENT_LENGTH = 500;

const REPLY_TEMPLATES = [
  { code: 'report_unclear', label: '解释报告', content: '您的报告主要用于帮助您了解本次训练动作情况。建议先结合报告中的“系统建议”回看动作要点，再按建议放慢节奏练习。' },
  { code: 'action_uncertain', label: '动作指导', content: '建议您回看动作指导中的拍摄要求和常见错误说明，练习时放慢动作、保持身体稳定，再重新提交训练视频。' },
  { code: 'upload_issue', label: '上传排查', content: '请检查网络是否稳定，并确认视频时长和拍摄画面符合要求；如仍无法提交，建议退出后重新进入训练页再试一次。' },
  { code: 'out_of_scope', label: '能力边界', content: '当前问题超出训练指导的处理范围。您可以继续查看训练报告和动作指导；如出现身体不适，请暂停训练并及时咨询医生。' },
];

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async getFeedbackImageUploadTarget(userId: number): Promise<FeedbackImageUploadTargetDto> {
    const timestamp = Date.now();
    const objectKey = `feedback/${userId}/${timestamp}.png`;
    // 生产环境主服务为只读容器，反馈图片必须像训练视频一样直传私有 OSS，
    // 不能再经过会写本地文件系统的 /feedback/upload-image 代理接口。
    return this.storage.createPrivateImageUploadTarget(objectKey);
  }

  async uploadFeedbackImage(userId: number, objectKey: string, file?: UploadedBinaryFile) {
    if (!file?.buffer || !file.buffer.length) throw new BadRequestException('未接收到图片文件');
    if (file.buffer.length > 5 * 1024 * 1024) throw new BadRequestException('单张图片不能超过 5 MB');
    if (!objectKey.startsWith(`feedback/${userId}/`)) throw new ForbiddenException('无权上传到他人的反馈目录');

    const stored = await this.storage.saveAssetFile(objectKey, {
      ...file,
      originalname: file.originalname || 'feedback.png',
    });
    return {
      objectKey: stored.objectKey,
      assetUrl: this.storage.getPrivateObjectUrl(stored.objectKey),
      size: stored.size,
    };
  }

  async createFeedback(userId: number, payload: CreateFeedbackRequestDto): Promise<FeedbackDto> {
    const imageUrls = this.validateImageUrls(userId, payload.imageUrls);
    const content = this.validateContent(payload.content, MAX_CONTENT_LENGTH, imageUrls.length > 0);
    if (payload.videoId) await this.ensureOwnVideo(userId, payload.videoId);

    const isSafety = payload.feedbackType === 'body_discomfort';
    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const feedback = await tx.feedback.create({
        data: {
          user_id: BigInt(userId),
          video_id: payload.videoId ? BigInt(payload.videoId) : null,
          feedback_type: payload.feedbackType,
          content,
          image_urls: imageUrls,
          status: isSafety ? 'closed' : 'pending',
          priority_level: isSafety ? 'high' : 'normal',
          handling_mode: isSafety ? 'safety_auto' : 'manual',
          last_message_at: now,
          closed_at: isSafety ? now : null,
          closed_by: isSafety ? 'system' : null,
          close_reason: isSafety ? 'safety_diversion' : null,
        },
      });
      const feedbackId = feedback.feedback_id;
      await tx.feedbackMessage.create({
        data: { feedback_id: feedbackId, sender_role: 'patient', sender_id: BigInt(userId), content, image_urls: imageUrls },
      });
      if (isSafety) {
        await tx.feedbackMessage.create({
          data: { feedback_id: feedbackId, sender_role: 'system', message_type: 'safety_notice', content: SAFETY_NOTICE, image_urls: [] },
        });
      }
      await tx.feedbackStatusLog.create({
        data: { feedback_id: feedbackId, to_status: feedback.status, operator_role: isSafety ? 'system' : 'patient', operator_id: isSafety ? null : BigInt(userId), reason: isSafety ? 'safety_diversion' : 'created' },
      });
      if (!isSafety) {
        await tx.notification.create({
          data: {
            user_id: BigInt(userId),
            notification_type: 'system_message',
            title: '已收到您的训练反馈',
            content: '工作人员将在方便时处理，处理结果会通过消息中心通知您。',
            related_id: String(feedbackId),
            read_flag: false,
          },
        });
      }
      return feedback;
    });

    return this.getPatientFeedbackDetail(userId, Number(created.feedback_id));
  }

  async listPatientFeedback(userId: number): Promise<FeedbackDto[]> {
    const feedbacks = await this.prisma.feedback.findMany({
      where: { user_id: BigInt(userId) },
      orderBy: { last_message_at: 'desc' },
      take: 50,
      include: { messages: { orderBy: { created_at: 'desc' }, take: 1 } },
    });
    return feedbacks.map((item) => this.toFeedbackDto(item, item.messages));
  }

  async getPatientFeedbackDetail(userId: number, feedbackId: number): Promise<FeedbackDto> {
    const feedback = await this.findFeedbackDetail(feedbackId);
    if (Number(feedback.user_id) !== userId) throw new ForbiddenException('无权查看他人的反馈');
    return this.toFeedbackDto(feedback, feedback.messages, feedback.status_logs);
  }

  async appendPatientMessage(userId: number, feedbackId: number, payload: { content?: string; imageUrls?: string[] }): Promise<FeedbackDto> {
    const imageUrls = this.validateImageUrls(userId, payload.imageUrls);
    const content = this.validateContent(payload.content, MAX_CONTENT_LENGTH, imageUrls.length > 0);
    const feedback = await this.prisma.feedback.findUnique({ where: { feedback_id: BigInt(feedbackId) } });
    if (!feedback) throw new NotFoundException(`反馈不存在: ${feedbackId}`);
    if (Number(feedback.user_id) !== userId) throw new ForbiddenException('无权补充他人的反馈');
    if (feedback.status === 'closed' || feedback.handling_mode === 'safety_auto') throw new BadRequestException('当前工单已结束，不能继续补充问题');

    await this.prisma.$transaction(async (tx) => {
      await tx.feedbackMessage.create({
        data: { feedback_id: BigInt(feedbackId), sender_role: 'patient', sender_id: BigInt(userId), content, image_urls: imageUrls },
      });
      await tx.feedback.update({ where: { feedback_id: BigInt(feedbackId) }, data: { status: 'pending', last_message_at: new Date() } });
      await tx.feedbackStatusLog.create({
        data: { feedback_id: BigInt(feedbackId), from_status: feedback.status, to_status: 'pending', operator_role: 'patient', operator_id: BigInt(userId), reason: 'patient_follow_up' },
      });
    });
    return this.getPatientFeedbackDetail(userId, feedbackId);
  }

  async getAdminFeedbackList(options: { safetyOnly?: boolean; keyword?: string; page?: number; limit?: number } = {}) {
    const keyword = options.keyword?.trim();
    const page = Math.max(1, Math.floor(options.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit || 10)));
    const numericKeyword = keyword && /^\d+$/.test(keyword) ? BigInt(keyword) : undefined;
    const where = {
      handling_mode: options.safetyOnly ? 'safety_auto' : 'manual',
      ...(keyword ? {
        OR: [
          ...(numericKeyword ? [{ feedback_id: numericKeyword }, { user_id: numericKeyword }] : []),
          { user: { name: { contains: keyword } } },
        ],
      } : {}),
    };
    const [total, feedbacks] = await this.prisma.$transaction([
      this.prisma.feedback.count({ where }),
      this.prisma.feedback.findMany({
        where,
        orderBy: [{ status: 'asc' }, { last_message_at: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { user: true, video: { include: { video_evaluation_result: true } }, messages: { orderBy: { created_at: 'desc' }, take: 1 } },
      }),
    ]);
    return {
      items: feedbacks.map((item) => ({
        ...this.toFeedbackDto(item, item.messages),
        patientId: Number(item.user_id),
        patientName: item.user.name || undefined,
      })),
      total,
      page,
      limit,
    };
  }

  async getAdminFeedbackDetail(feedbackId: number): Promise<AdminFeedbackListItemDto> {
    const feedback = await this.findFeedbackDetail(feedbackId, true);
    return {
      ...this.toFeedbackDto(feedback, feedback.messages, feedback.status_logs),
      patientId: Number(feedback.user_id),
      patientName: feedback.user?.name || undefined,
    };
  }

  async startFeedback(feedbackId: number, accountId: number) {
    const feedback = await this.getManualFeedback(feedbackId);
    if (feedback.status !== 'pending') throw new BadRequestException('仅待处理工单可以开始处理');
    await this.transitionFeedback(feedbackId, feedback.status, 'processing', 'staff', accountId, 'started');
    return { feedbackId, status: 'processing' as FeedbackStatus };
  }

  async replyFeedback(feedbackId: number, accountId: number, payload: { content?: string; templateCode?: string }) {
    const feedback = await this.getManualFeedback(feedbackId);
    if (feedback.status === 'closed') throw new BadRequestException('工单已关闭，不能继续回复');
    const content = this.validateContent(payload.content, 1_000);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.feedbackMessage.create({
        data: { feedback_id: BigInt(feedbackId), sender_role: 'staff', sender_id: BigInt(accountId), content, image_urls: [], template_code: payload.templateCode || null },
      });
      await tx.feedbackReply.create({
        data: { feedback_id: BigInt(feedbackId), replier_account_id: BigInt(accountId), reply_content: content },
      });
      await tx.feedback.update({
        where: { feedback_id: BigInt(feedbackId) },
        data: { status: 'replied', last_message_at: now, first_replied_at: feedback.first_replied_at || now },
      });
      await tx.feedbackStatusLog.create({
        data: { feedback_id: BigInt(feedbackId), from_status: feedback.status, to_status: 'replied', operator_role: 'staff', operator_id: BigInt(accountId), reason: 'staff_reply' },
      });
      await tx.notification.create({
        data: { user_id: feedback.user_id, notification_type: 'feedback_replied', title: '您的训练反馈有新回复', content: '工作人员已回复您提交的训练问题，点击查看详情。', related_id: String(feedbackId), read_flag: false },
      });
    });
    return { feedbackId, status: 'replied' as FeedbackStatus, content };
  }

  async closeFeedback(feedbackId: number, accountId: number, reason: 'resolved' | 'inactive_7d' | 'no_further_response_needed') {
    const feedback = await this.getManualFeedback(feedbackId);
    if (feedback.status === 'closed') throw new BadRequestException('工单已关闭');
    if (!['pending', 'processing', 'replied'].includes(feedback.status)) throw new BadRequestException('当前工单状态不能关闭');
    await this.prisma.$transaction(async (tx) => {
      await tx.feedback.update({ where: { feedback_id: BigInt(feedbackId) }, data: { status: 'closed', closed_at: new Date(), closed_by: String(accountId), close_reason: reason } });
      await tx.feedbackStatusLog.create({
        data: { feedback_id: BigInt(feedbackId), from_status: feedback.status, to_status: 'closed', operator_role: 'staff', operator_id: BigInt(accountId), reason },
      });
    });
    return { feedbackId, status: 'closed' as FeedbackStatus };
  }

  async batchCloseInactiveFeedback(accountId: number) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const items = await this.prisma.feedback.findMany({
      where: { handling_mode: 'manual', status: 'replied', last_message_at: { lte: cutoff } },
      select: { feedback_id: true },
    });
    await Promise.all(items.map((item) => this.closeFeedback(Number(item.feedback_id), accountId, 'inactive_7d')));
    return { closedCount: items.length };
  }

  getReplyTemplates() {
    return REPLY_TEMPLATES;
  }

  private async findFeedbackDetail(feedbackId: number, includeUser = false) {
    const feedback = await this.prisma.feedback.findUnique({
      where: { feedback_id: BigInt(feedbackId) },
      include: {
        ...(includeUser ? { user: true } : {}),
        video: { include: { video_evaluation_result: true } },
        messages: { orderBy: { created_at: 'asc' } },
        status_logs: { orderBy: { created_at: 'asc' } },
        replies: { orderBy: { created_at: 'asc' } },
      },
    });
    if (!feedback) throw new NotFoundException(`反馈不存在: ${feedbackId}`);
    return feedback;
  }

  private async getManualFeedback(feedbackId: number) {
    const feedback = await this.prisma.feedback.findUnique({ where: { feedback_id: BigInt(feedbackId) } });
    if (!feedback) throw new NotFoundException(`反馈不存在: ${feedbackId}`);
    if (feedback.handling_mode !== 'manual') throw new BadRequestException('安全分流记录不支持此操作');
    return feedback;
  }

  private async transitionFeedback(feedbackId: number, fromStatus: string, toStatus: FeedbackStatus, operatorRole: 'staff', operatorId: number, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.feedback.update({ where: { feedback_id: BigInt(feedbackId) }, data: { status: toStatus } });
      await tx.feedbackStatusLog.create({
        data: { feedback_id: BigInt(feedbackId), from_status: fromStatus, to_status: toStatus, operator_role: operatorRole, operator_id: BigInt(operatorId), reason },
      });
    });
  }

  private toFeedbackDto(feedback: any, messages: any[] = [], logs: any[] = []): FeedbackDto {
    const normalizedMessages: FeedbackMessageDto[] = messages.map((message) => ({
      messageId: Number(message.message_id),
      senderRole: message.sender_role,
      content: message.content,
      imageUrls: this.toAccessibleImageUrls(message.image_urls),
      createdAt: message.created_at.toISOString(),
    }));
    const initialImages = this.toAccessibleImageUrls(feedback.image_urls);
    const hasInitialPatientMessage = normalizedMessages.some((message) => message.senderRole === 'patient' && message.content === feedback.content);
    if (!hasInitialPatientMessage && feedback.content) {
      normalizedMessages.push({
        messageId: -Number(feedback.feedback_id) * 10 - 1,
        senderRole: 'patient',
        content: feedback.content,
        imageUrls: initialImages,
        createdAt: feedback.created_at.toISOString(),
      });
    }
    for (const [index, reply] of (feedback.replies || []).entries()) {
      const hasReplyMessage = normalizedMessages.some((message) => message.senderRole === 'staff' && message.content === reply.reply_content);
      if (!hasReplyMessage && reply.reply_content) {
        normalizedMessages.push({
          messageId: -Number(feedback.feedback_id) * 10 - 2 - index,
          senderRole: 'staff',
          content: reply.reply_content,
          imageUrls: [],
          createdAt: reply.created_at.toISOString(),
        });
      }
    }
    normalizedMessages.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    const normalizedLogs: FeedbackStatusLogDto[] = logs.map((log) => ({
      fromStatus: log.from_status || undefined,
      toStatus: log.to_status,
      operatorRole: log.operator_role,
      reason: log.reason || undefined,
      createdAt: log.created_at.toISOString(),
    }));
    const legacyReply = feedback.replies?.[0]?.reply_content;
    return {
      feedbackId: Number(feedback.feedback_id),
      status: feedback.status,
      feedbackType: feedback.feedback_type,
      content: feedback.content,
      imageUrls: this.toAccessibleImageUrls(feedback.image_urls),
      videoId: feedback.video_id ? Number(feedback.video_id) : undefined,
      replyContent: normalizedMessages.filter((item) => item.senderRole === 'staff').at(-1)?.content || legacyReply || undefined,
      createdAt: feedback.created_at.toISOString(),
      lastMessageAt: feedback.last_message_at?.toISOString(),
      handlingMode: feedback.handling_mode,
      priorityLevel: feedback.priority_level,
      closeReason: feedback.close_reason || undefined,
      messages: normalizedMessages.length ? normalizedMessages : undefined,
      statusLogs: normalizedLogs.length ? normalizedLogs : undefined,
      trainingContext: feedback.video ? {
        videoId: Number(feedback.video.video_id),
        actionType: feedback.video.action_type,
        duration: feedback.video.duration ?? undefined,
        analysisStatus: feedback.video.analysis_status,
        qualityStatus: feedback.video.quality_status ?? undefined,
        uploadedAt: feedback.video.upload_time.toISOString(),
        averageScore: feedback.video.video_evaluation_result?.average_score ?? undefined,
        grade: feedback.video.video_evaluation_result?.grade ?? undefined,
      } : undefined,
    };
  }

  private validateContent(value: unknown, maxLength = MAX_CONTENT_LENGTH, allowEmpty = false) {
    const content = String(value || '').trim();
    if (content.length < 1 && !allowEmpty) throw new BadRequestException('请填写反馈内容或至少上传一张图片');
    if (content.length > maxLength) throw new BadRequestException(`反馈内容不能超过 ${maxLength} 个字`);
    return content;
  }

  private validateImageUrls(userId: number, imageUrls?: string[]) {
    const urls = Array.isArray(imageUrls) ? imageUrls : [];
    if (urls.length > MAX_IMAGE_COUNT) throw new BadRequestException('最多上传 3 张图片');
    const expectedPrefix = `feedback/${userId}/`;
    if (urls.some((url) => typeof url !== 'string' || !url.startsWith(expectedPrefix))) {
      throw new ForbiddenException('图片地址无效或不属于当前患者');
    }
    return urls;
  }

  private asImageUrls(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private toAccessibleImageUrls(value: unknown): string[] {
    return this.asImageUrls(value).map((objectKey) => {
      if (objectKey.startsWith('feedback/')) {
        return this.storage.getPrivateObjectUrl(objectKey);
      }
      // 兼容早期本地开发数据；生产配置禁止公开患者资产。
      return objectKey;
    });
  }

  private async ensureOwnVideo(userId: number, videoId: number) {
    const video = await this.prisma.trainingVideo.findUnique({ where: { video_id: BigInt(videoId) } });
    if (!video || Number(video.user_id) !== userId) throw new ForbiddenException('无权对他人的训练记录提交反馈');
  }
}
