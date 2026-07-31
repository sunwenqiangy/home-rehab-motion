"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const appConfig_1 = require("../../services/appConfig");
const feedback_1 = require("../../services/feedback");
const report_1 = require("../../services/report");
const video_1 = require("../../services/video");
function getAppConfig() {
    const app = getApp();
    return app.globalData.appConfig || appConfig_1.DEFAULT_APP_CONFIG;
}
const ACTION_LABEL_MAP = {
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
};
const STAGE_LABEL_MAP = {
    corrective: '熟悉动作',
    consolidation: '稳定练习',
    incentive: '坚持成长',
};
function getGradeTag(grade, averageScore) {
    if (grade === '优秀' || averageScore >= 90) {
        return '建议继续保持';
    }
    if (grade === '良好' || averageScore >= 75) {
        return '继续练会更稳';
    }
    return '按建议再练一遍';
}
function getGrowthValue(validReps, totalReps) {
    if (!totalReps) {
        return '待积累';
    }
    if (validReps === totalReps) {
        return '+1';
    }
    if (validReps / totalReps >= 0.7) {
        return '稳定中';
    }
    return '继续加油';
}
function formatDuration(seconds) {
    if (!seconds) {
        return '训练时长待更新';
    }
    if (seconds < 60) {
        return `训练 ${Math.round(seconds)} 秒`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = Math.round(seconds % 60);
    return remainSeconds ? `训练 ${minutes} 分 ${remainSeconds} 秒` : `训练 ${minutes} 分钟`;
}
function getNetworkType() {
    return new Promise((resolve) => {
        wx.getNetworkType({
            success: (result) => resolve(result.networkType || 'unknown'),
            fail: () => resolve('unknown'),
        });
    });
}
function resolveStageFocus(stage) {
    if (stage === 'corrective') {
        return {
            title: '熟悉动作（第1~2周）重点',
            desc: '跟着步骤慢慢做，找到舒服、稳定的动作节奏。',
            prevLabel: '起始阶段',
            nextLabel: '下一阶段：稳定练习',
        };
    }
    if (stage === 'incentive') {
        return {
            title: '坚持成长（第5周+）重点',
            desc: '关注连续训练、累计训练日和徽章，保持自己的节奏。',
            prevLabel: '上一阶段：稳定练习',
            nextLabel: '当前保持成长节奏',
        };
    }
    return {
        title: '稳定练习（第3~4周）重点',
        desc: '保持节奏一致，逐步把动作做得更稳，保持时间再延长 1~2 秒。',
        prevLabel: '上一阶段：熟悉动作',
        nextLabel: '下一阶段：坚持成长',
    };
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        loading: true,
        loadFailed: false,
        errorMessage: '',
        errorIcon: '⚠️',
        errorTitle: '',
        isAnalysisFailed: false,
        failureTitle: '',
        failureReason: '',
        feedbackEntryLoading: false,
        activeFeedbackId: 0,
        feedbackEntryLabel: '提交反馈',
        videoId: 0,
        grade: '',
        averageScore: 0,
        requiresManualReview: false,
        reviewMessage: '',
        actionLabel: '本次训练',
        actionType: 'abdominal_crunch',
        durationText: '训练时长待更新',
        growthValue: '待积累',
        stageLabel: '稳定练习',
        compareToLastText: '',
        trendSummary: '',
        stageFocusTitle: '当前阶段重点',
        stageFocusDesc: '',
        stagePrevLabel: '',
        stageNextLabel: '',
        streakValue: '0 / 7',
        streakProgress: 18,
        streakDesc: '本周完成训练后，会更容易看到持续变化。',
        streakCarryoverText: '',
        validRepsText: '0 / 0',
        holdDurationText: '0 秒',
        confidenceText: '待更新',
        accuracyText: '待更新',
        stabilityText: '待更新',
        controlText: '待更新',
        durationMetricText: '待更新',
        mainIssues: [],
        adviceSummary: [],
        badgeSummaryText: '',
        improvementMessage: '',
        newlyUnlockedBadges: [],
        showSafetyNotice: false,
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    onShow() {
        // 从反馈页返回时重新查询关联工单，避免仍显示“提交反馈”。
        if (this.data.videoId && !this.data.loading) {
            this.refreshFeedbackEntry();
        }
    },
    async onLoad(query) {
        const sysInfo = wx.getSystemInfoSync();
        const statusBarHeight = sysInfo.statusBarHeight || 20;
        const videoId = Number(query.videoId || 1);
        const showSafetyNotice = query.safetyNotice === '1';
        const cfg = getAppConfig();
        const weeklyTarget = cfg.weeklyTarget;
        this.setData({
            videoId,
            statusBarHeight,
            showSafetyNotice,
            streakValue: `0 / ${weeklyTarget}`,
            streakProgress: 18,
            streakDesc: `本周完成 ${weeklyTarget} 天训练后，会更容易看到持续变化。`,
        });
        try {
            const report = await (0, report_1.getReport)(videoId);
            const actionLabel = ACTION_LABEL_MAP[report.actionType] || '本次训练';
            const badgeSummaryText = report.badgeSummary.length
                ? report.badgeSummary.map((item) => item.title).join(' / ')
                : '暂无新徽章';
            const motivationStage = report.motivation?.stage || report.stage;
            const stageLabel = STAGE_LABEL_MAP[motivationStage] || '熟悉动作';
            const stageFocus = resolveStageFocus(motivationStage);
            this.setData({
                loadFailed: false,
                isAnalysisFailed: false,
                errorMessage: '',
                grade: report.grade,
                averageScore: report.averageScore,
                requiresManualReview: Boolean(report.requiresManualReview),
                reviewMessage: report.reviewMessage || '',
                actionLabel,
                actionType: report.actionType,
                durationText: formatDuration(report.duration),
                growthValue: report.requiresManualReview ? '待复核' : getGrowthValue(report.validReps, report.totalReps),
                stageLabel,
                compareToLastText: report.compareToLast || '',
                trendSummary: report.trendSummary || '',
                stageFocusTitle: stageFocus.title,
                stageFocusDesc: stageFocus.desc,
                stagePrevLabel: stageFocus.prevLabel,
                stageNextLabel: stageFocus.nextLabel,
                streakValue: report.motivation
                    ? `${report.motivation.weeklyTrainingDays} / ${report.motivation.weeklyTargetDays}`
                    : report.streakSummary.label,
                streakProgress: report.motivation
                    ? Math.min(100, Math.round((report.motivation.weeklyTrainingDays / Math.max(1, report.motivation.weeklyTargetDays)) * 100))
                    : report.streakSummary.progressPercent,
                streakDesc: report.motivation?.encourageText || report.streakSummary.desc,
                streakCarryoverText: report.motivation?.nearestBadge?.message || report.streakSummary.carryoverText || '',
                validRepsText: `${report.validReps} / ${report.totalReps}`,
                holdDurationText: report.avgHoldDuration ? `${Math.round(report.avgHoldDuration)} 秒` : '待更新',
                confidenceText: report.requiresManualReview ? '待复核' : (report.confidenceScore ? `${Math.round(report.confidenceScore * 100)}%` : '待更新'),
                accuracyText: report.accuracyAvg != null ? `${Math.round(report.accuracyAvg)}` : '待更新',
                stabilityText: report.stabilityAvg != null ? `${Math.round(report.stabilityAvg)}` : '待更新',
                controlText: report.controlAvg != null ? `${Math.round(report.controlAvg)}` : '待更新',
                durationMetricText: report.durationAvg != null ? `${Math.round(report.durationAvg)}` : '待更新',
                mainIssues: report.mainIssues,
                adviceSummary: report.adviceSummary || [],
                badgeSummaryText,
                improvementMessage: report.motivation?.improvementMessage || report.trendSummary || '',
                newlyUnlockedBadges: report.newlyUnlockedBadges || [],
            });
        }
        catch (_error) {
            try {
                const status = await (0, video_1.getVideoStatus)(videoId);
                const isAnalysisFailed = status.status === 'failed' || status.status === 'quality_insufficient';
                if (isAnalysisFailed) {
                    this.setData({
                        loadFailed: false,
                        isAnalysisFailed: true,
                        failureTitle: status.status === 'quality_insufficient' ? '视频质量不足，暂未生成报告' : '本次训练暂未生成结果',
                        failureReason: status.status === 'quality_insufficient'
                            ? (status.failReason || '请确保动作完整入镜、画面清晰稳定后再重新上传。')
                            : '系统暂时无法完成本次视频分析。请重新上传一段完整、清晰的训练视频后再试。',
                    });
                }
                else {
                    this.setData({
                        loadFailed: true,
                        isAnalysisFailed: false,
                        errorIcon: '⏳',
                        errorTitle: '报告仍在生成中',
                        errorMessage: '分析结果尚未生成完成，您可以继续等待，或稍后从训练历史查看。',
                    });
                }
            }
            catch (_statusError) {
                const isOffline = (await getNetworkType()) === 'none';
                this.setData({
                    loadFailed: true,
                    isAnalysisFailed: false,
                    errorIcon: isOffline ? '📡' : '⚠️',
                    errorTitle: isOffline ? '网络连接不可用' : '报告暂时不可用',
                    errorMessage: isOffline
                        ? '请检查网络连接后重新获取报告。'
                        : '服务可能正在繁忙或维护中，请稍后重新获取报告。',
                });
            }
        }
        finally {
            this.setData({ loading: false });
            this.updateTopPlaceholderHeight();
            this.refreshFeedbackEntry();
        }
    },
    updateTopPlaceholderHeight() {
        wx.nextTick(() => {
            const query = wx.createSelectorQuery();
            query
                .select('.rp-top-sticky')
                .boundingClientRect((rect) => {
                if (rect?.height) {
                    this.setData({ topPlaceholderHeight: Math.ceil(rect.height) });
                }
            })
                .exec();
        });
    },
    onGoBack() {
        const pages = getCurrentPages();
        if (pages.length > 1) {
            wx.navigateBack({ delta: 1 });
            return;
        }
        wx.redirectTo({ url: '/pages/history/index' });
    },
    async refreshFeedbackEntry() {
        if (!this.data.videoId)
            return;
        try {
            const feedbacks = await (0, feedback_1.getPatientFeedbackList)();
            const activeTicket = feedbacks.find((item) => item.videoId === this.data.videoId && item.status !== 'closed' && item.handlingMode !== 'safety_auto');
            this.setData({
                activeFeedbackId: activeTicket?.feedbackId || 0,
                feedbackEntryLabel: activeTicket ? '查看并补充反馈' : '提交反馈',
            });
        }
        catch (_error) {
            this.setData({ activeFeedbackId: 0, feedbackEntryLabel: '提交反馈' });
        }
    },
    onToggleFeedback() {
        if (this.data.feedbackEntryLoading)
            return;
        if (this.data.activeFeedbackId) {
            wx.navigateTo({ url: `/pages/feedback/detail?feedbackId=${this.data.activeFeedbackId}&returnTo=report` });
            return;
        }
        wx.navigateTo({
            url: `/pages/feedback/submit?videoId=${this.data.videoId}&actionLabel=${encodeURIComponent(this.data.actionLabel)}`,
        });
    },
    onBackHome() {
        wx.redirectTo({ url: `/pages/upload/index?actionType=${this.data.actionType}&source=report` });
    },
    onRetryUpload() {
        wx.redirectTo({ url: `/pages/upload/index?actionType=${this.data.actionType}&source=report` });
    },
    onRetryLoad() {
        if (!this.data.videoId) {
            return;
        }
        this.setData({ loading: true, loadFailed: false, errorMessage: '' });
        this.onLoad({ videoId: String(this.data.videoId) });
    },
    onViewAnalyzing() {
        if (!this.data.videoId) {
            return;
        }
        wx.redirectTo({ url: `/pages/analyzing/index?videoId=${this.data.videoId}` });
    },
    onViewHistory() {
        // 从报告查看列表属于流程切换，替换当前报告页，避免“报告 → 历史 → 报告”反复累积。
        wx.redirectTo({ url: '/pages/history/index' });
    },
    getResultTagText() {
        return getGradeTag(this.data.grade, this.data.averageScore);
    },
});
