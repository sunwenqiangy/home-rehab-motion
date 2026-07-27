<template>
  <div class="admin-page dashboard-page">
    <section class="page-hero">
      <div class="page-hero__content">
        <div>
          <div class="page-hero__eyebrow">Mission Overview</div>
          <h1 class="page-hero__title">训练分析总览</h1>
          <p class="page-hero__subtitle">
            统一查看患者训练提交、指导内容覆盖、待处理反馈与分析完成率，帮助医护团队快速发现异常并推进干预。
          </p>
          <div class="page-hero__meta">
            <span class="page-pill">今日同步：{{ stats.videoCount }} 条训练记录</span>
            <span class="page-pill">待跟进反馈：{{ stats.pendingFeedback }} 条</span>
          </div>
        </div>

        <div class="page-hero__side">
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">完成率快照</div>
            <div class="hero-glass-card__value">{{ completionRate }}%</div>
            <div class="hero-glass-card__hint">已完成分析 / 总训练视频</div>
          </div>
          <div class="hero-glass-card">
            <div class="hero-glass-card__label">内容覆盖度</div>
            <div class="hero-glass-card__value">{{ stats.guidanceCount }}</div>
            <div class="hero-glass-card__hint">当前系统可用指导动作内容数</div>
          </div>
        </div>
      </div>
    </section>

    <section class="metric-grid">
      <article class="metric-card">
        <div class="metric-card__label">训练视频</div>
        <div class="metric-card__value">{{ stats.videoCount }}</div>
        <div class="metric-card__foot">
          <span>最近 5 条会出现在下方工作流列表</span>
          <span class="metric-card__icon"><el-icon><VideoCamera /></el-icon></span>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-card__label">指导内容</div>
        <div class="metric-card__value">{{ stats.guidanceCount }}</div>
        <div class="metric-card__foot">
          <span>覆盖核心训练动作模板</span>
          <span class="metric-card__icon"><el-icon><Reading /></el-icon></span>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-card__label">待处理反馈</div>
        <div class="metric-card__value">{{ stats.pendingFeedback }}</div>
        <div class="metric-card__foot">
          <span :class="stats.pendingFeedback ? 'metric-card__trend--warn' : 'metric-card__trend--up'">
            {{ stats.pendingFeedback ? '需要优先跟进' : '当前无阻塞项' }}
          </span>
          <span class="metric-card__icon"><el-icon><ChatDotRound /></el-icon></span>
        </div>
      </article>
      <article class="metric-card">
        <div class="metric-card__label">分析完成</div>
        <div class="metric-card__value">{{ stats.completedAnalysis }}</div>
        <div class="metric-card__foot">
          <span class="metric-card__trend--up">训练结果已可回查</span>
          <span class="metric-card__icon"><el-icon><TrendCharts /></el-icon></span>
        </div>
      </article>
    </section>

    <section class="dashboard-grid">
      <el-card class="surface-card dashboard-main-card" shadow="never">
        <template #header>
          <div class="section-header">
            <div>
              <div class="section-header__title">最近视频记录</div>
              <div class="section-header__subtitle">优先查看最近上传或分析失败的训练视频。</div>
            </div>
            <el-button type="primary" plain @click="router.push('/videos')">查看全部</el-button>
          </div>
        </template>

        <div class="table-shell">
          <el-table :data="recentVideos" stripe style="width: 100%">
            <el-table-column prop="videoId" label="ID" width="88" />
            <el-table-column prop="actionType" label="动作类型" min-width="150">
              <template #default="{ row }">{{ actionTypeLabel(row.actionType) }}</template>
            </el-table-column>
            <el-table-column prop="patientName" label="患者" min-width="120">
              <template #default="{ row }">{{ row.patientName || '未命名患者' }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="140">
              <template #default="{ row }">
                <span class="soft-tag" :class="tagClass(row.status)">{{ statusLabel(row.status) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="uploadedAt" label="上传时间" min-width="180" />
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link @click="router.push(`/videos/${row.videoId}`)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>

      <div class="dashboard-side-column">
        <el-card class="surface-card surface-card--dark" shadow="never">
          <template #header>
            <div class="section-header section-header--dark">
              <div>
                <div class="section-header__title section-header__title--dark">今日节奏</div>
                <div class="section-header__subtitle section-header__subtitle--dark">当前后台工作的关键观察点</div>
              </div>
            </div>
          </template>

          <div class="ops-timeline">
            <div class="ops-timeline__item">
              <span class="ops-timeline__dot"></span>
              <div>
                <strong>{{ stats.pendingFeedback }} 条待处理反馈</strong>
                <p>及时回复患者问题，优先处理上传异常和身体不适类反馈。</p>
              </div>
            </div>
            <div class="ops-timeline__item">
              <span class="ops-timeline__dot"></span>
              <div>
                <strong>{{ stats.completedAnalysis }} 条报告已完成</strong>
                <p>检查分析失败项与质量不足项，确认是否需要补录或人工介入。</p>
              </div>
            </div>
            <div class="ops-timeline__item">
              <span class="ops-timeline__dot"></span>
              <div>
                <strong>{{ stats.guidanceCount }} 个指导模板在线</strong>
                <p>保持指导内容、阈值配置与患者训练动作的一致性。</p>
              </div>
            </div>
          </div>
        </el-card>

        <el-card class="surface-card" shadow="never">
          <template #header>
            <div class="section-header">
              <div>
                <div class="section-header__title">快速入口</div>
                <div class="section-header__subtitle">进入最常操作的后台模块。</div>
              </div>
            </div>
          </template>

          <div class="quick-links">
            <button class="quick-link-card" type="button" @click="router.push('/guidance')">
              <span class="quick-link-card__icon"><el-icon><Reading /></el-icon></span>
              <span>
                <strong>指导内容</strong>
                <small>管理训练动作文案与素材</small>
              </span>
            </button>
            <button class="quick-link-card" type="button" @click="router.push('/feedback')">
              <span class="quick-link-card__icon"><el-icon><ChatDotRound /></el-icon></span>
              <span>
                <strong>反馈管理</strong>
                <small>跟进患者问题与答复</small>
              </span>
            </button>
            <button class="quick-link-card" type="button" @click="router.push('/thresholds')">
              <span class="quick-link-card__icon"><el-icon><Setting /></el-icon></span>
              <span>
                <strong>阈值参数</strong>
                <small>查看算法配置与版本</small>
              </span>
            </button>
          </div>
        </el-card>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  ChatDotRound,
  Reading,
  Setting,
  TrendCharts,
  VideoCamera,
} from '@element-plus/icons-vue';
import { getAdminVideoList } from '@/services/video';
import { getGuidanceList } from '@/services/guidance';
import { getFeedbackList } from '@/services/feedback';
import type { AnalysisStatus, TrainingActionType } from '@home-rehab-motion/shared-types';
import { ANALYSIS_STATUS_LABELS } from '@home-rehab-motion/shared-constants';

const router = useRouter();

const stats = reactive({
  videoCount: 0,
  guidanceCount: 0,
  pendingFeedback: 0,
  completedAnalysis: 0,
});

const recentVideos = ref<any[]>([]);

const completionRate = computed(() => {
  if (!stats.videoCount) return 0;
  return Math.round((stats.completedAnalysis / stats.videoCount) * 100);
});

function actionTypeLabel(type: TrainingActionType): string {
  const map: Record<string, string> = {
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
  };
  return map[type] || type;
}

function statusLabel(status: AnalysisStatus): string {
  return (ANALYSIS_STATUS_LABELS as any)[status] || status;
}

function tagClass(status: AnalysisStatus): string {
  const map: Record<string, string> = {
    pending: 'soft-tag--info',
    uploading: 'soft-tag--info',
    queued: 'soft-tag--warning',
    processing: 'soft-tag--warning',
    completed: 'soft-tag--success',
    failed: 'soft-tag--danger',
    quality_insufficient: 'soft-tag--danger',
  };
  return map[status] || 'soft-tag--info';
}

onMounted(async () => {
  try {
    const [videos, guidanceList, feedbackList] = await Promise.all([
      getAdminVideoList().catch(() => []),
      getGuidanceList().catch(() => []),
      getFeedbackList().catch(() => []),
    ]);

    stats.videoCount = videos.length;
    stats.guidanceCount = guidanceList.length;
    stats.pendingFeedback = feedbackList.filter((f: any) => f.status === 'pending').length;
    stats.completedAnalysis = videos.filter((v: any) => v.status === 'completed').length;
    recentVideos.value = videos.slice(0, 5);
  } catch {
    // dashboard 页面以展示为主，不阻断渲染
  }
});
</script>

<style scoped>
.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.88fr);
  gap: 20px;
}

.dashboard-side-column {
  display: grid;
  gap: 20px;
}

.ops-timeline {
  display: grid;
  gap: 16px;
}

.ops-timeline__item {
  display: grid;
  grid-template-columns: 16px 1fr;
  gap: 12px;
  align-items: flex-start;
}

.ops-timeline__dot {
  width: 10px;
  height: 10px;
  margin-top: 7px;
  border-radius: 999px;
  background: #79d7ff;
  box-shadow: 0 0 0 8px rgba(121, 215, 255, 0.12);
}

.ops-timeline__item strong {
  display: block;
  color: #f6fbff;
  font-size: 14px;
}

.ops-timeline__item p {
  margin: 6px 0 0;
  color: rgba(226, 241, 250, 0.72);
  font-size: 12px;
  line-height: 1.8;
}

.section-header--dark .section-header__title,
.section-header__title--dark {
  color: #f6fbff;
}

.section-header--dark .section-header__subtitle,
.section-header__subtitle--dark {
  color: rgba(226, 241, 250, 0.62);
}

.quick-links {
  display: grid;
  gap: 12px;
}

.quick-link-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 18px;
  border: 1px solid rgba(148, 180, 214, 0.18);
  border-radius: 18px;
  background: rgba(248, 251, 255, 0.7);
  text-align: left;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.quick-link-card:hover {
  transform: translateY(-2px);
  border-color: rgba(79, 195, 247, 0.28);
  box-shadow: 0 18px 40px rgba(15, 40, 79, 0.08);
}

.quick-link-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(79, 195, 247, 0.12);
  color: var(--brand-700);
  font-size: 18px;
}

.quick-link-card strong {
  display: block;
  color: var(--ink-950);
  font-size: 14px;
}

.quick-link-card small {
  display: block;
  margin-top: 4px;
  color: var(--ink-500);
  font-size: 12px;
}

@media (max-width: 1180px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
