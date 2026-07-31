import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface PatientListQuery {
  keyword?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class PatientAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listPatients(query: PatientListQuery) {
    const requestedPage = this.normalizePositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
    const limit = this.normalizePositiveInt(query.limit, 10, 100);
    const keyword = String(query.keyword || '').trim();
    const where = {
      role: 'patient',
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { openid: { contains: keyword } },
            ],
          }
        : {}),
    };

    const page = requestedPage;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const [total, users, allPatients] = await this.prisma.$transaction([
      this.prisma.userProfile.count({ where }),
      this.prisma.userProfile.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          training_videos: {
            orderBy: { upload_time: 'desc' },
            include: { video_evaluation_result: true },
          },
        },
      }),
      this.prisma.userProfile.findMany({
        where: { role: 'patient' },
        include: {
          training_videos: {
            orderBy: { upload_time: 'desc' },
            include: { video_evaluation_result: true },
          },
        },
      }),
    ]);

    const activeTrainingPatientCount = allPatients.filter((patient) =>
      patient.training_videos.filter((video) => video.upload_time >= sevenDaysAgo).length > 3,
    ).length;
    const followUpPatientCount = allPatients.filter((patient) => {
      const latestEvaluatedVideo = patient.training_videos.find(
        (video) => video.analysis_status === 'completed' && Boolean(video.video_evaluation_result?.grade),
      );
      return latestEvaluatedVideo?.video_evaluation_result?.grade === '需改进'
        || latestEvaluatedVideo?.video_evaluation_result?.grade === '无效';
    }).length;

    return {
      items: users.map((user) => this.toPatientListItem(user)),
      total,
      overview: {
        totalPatientCount: allPatients.length,
        activeTrainingPatientCount,
        followUpPatientCount,
      },
      page,
      limit,
    };
  }

  async getPatientDetail(patientId: number) {
    const user = await this.prisma.userProfile.findFirst({
      where: { user_id: BigInt(patientId), role: 'patient' },
      include: {
        training_videos: {
          orderBy: { upload_time: 'desc' },
          include: { video_evaluation_result: true },
        },
        feedbacks: {
          orderBy: { created_at: 'desc' },
          take: 20,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('患者不存在');
    }

    const videos = user.training_videos;
    const completedVideos = videos.filter((item) => item.analysis_status === 'completed');
    const scores = completedVideos
      .map((item) => item.video_evaluation_result?.average_score)
      .filter((score): score is number => typeof score === 'number');
    const latestVideo = videos[0];
    const latestEvaluatedVideo = completedVideos.find((item) => Boolean(item.video_evaluation_result?.grade));

    return {
      patientId: Number(user.user_id),
      name: user.name || '未命名患者',
      openid: user.openid,
      gender: this.genderLabel(user.gender),
      age: user.age,
      phone: user.phone,
      registeredAt: user.created_at.toISOString(),
      trainingSummary: {
        totalTrainingCount: videos.length,
        completedTrainingCount: completedVideos.length,
        averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
        latestTrainingAt: latestVideo?.upload_time.toISOString() || null,
        latestGrade: latestEvaluatedVideo?.video_evaluation_result?.grade || null,
        pendingFeedbackCount: user.feedbacks.filter((item) => item.status === 'pending' || item.status === 'processing').length,
      },
      videos: videos.map((item) => ({
        videoId: Number(item.video_id),
        actionType: item.action_type,
        status: item.analysis_status,
        uploadedAt: item.upload_time.toISOString(),
        duration: item.duration,
        averageScore: item.video_evaluation_result?.average_score ?? null,
        grade: item.video_evaluation_result?.grade ?? null,
      })),
      scoreTrend: completedVideos
        .filter((item) => typeof item.video_evaluation_result?.average_score === 'number')
        .slice()
        .reverse()
        .map((item) => ({
          videoId: Number(item.video_id),
          actionType: item.action_type,
          uploadedAt: item.upload_time.toISOString(),
          score: item.video_evaluation_result?.average_score ?? 0,
          grade: item.video_evaluation_result?.grade ?? null,
        })),
    };
  }

  private toPatientListItem(user: any) {
    const videos = user.training_videos as Array<any>;
    const latestVideo = videos[0];
    const completedVideos = videos.filter((item) => item.analysis_status === 'completed');
    const latestEvaluatedVideo = completedVideos.find((item) => Boolean(item.video_evaluation_result?.grade));
    const scores = completedVideos
      .map((item) => item.video_evaluation_result?.average_score)
      .filter((score): score is number => typeof score === 'number');

    return {
      patientId: Number(user.user_id),
      name: user.name || '未命名患者',
      openid: user.openid,
      gender: this.genderLabel(user.gender),
      age: user.age,
      registeredAt: user.created_at.toISOString(),
      totalTrainingCount: videos.length,
      completedTrainingCount: completedVideos.length,
      averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      latestTrainingAt: latestVideo?.upload_time.toISOString() || null,
      latestGrade: latestEvaluatedVideo?.video_evaluation_result?.grade || null,
      latestVideoId: latestVideo ? Number(latestVideo.video_id) : null,
    };
  }

  private genderLabel(gender: number | null) {
    if (gender === 1) return '男';
    if (gender === 2) return '女';
    return '未填写';
  }

  private normalizePositiveInt(value: number | undefined, fallback: number, max: number) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1) return fallback;
    return Math.min(numeric, max);
  }
}
