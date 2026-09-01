"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const feedback_1 = require("../../services/feedback");
const report_1 = require("../../services/report");
const video_1 = require("../../services/video");
const ACTION_LABEL_MAP = {
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
};
function getNetworkType() {
    return new Promise((resolve) => {
        wx.getNetworkType({
            success: (result) => resolve(result.networkType || 'unknown'),
            fail: () => resolve('unknown'),
        });
    });
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
        reportFocusTitle: '本次先熟悉动作',
        reportFocusText: '',
        compareToLastText: '',
        validRepsText: '0 / 0',
        holdDurationText: '0 秒',
        accuracyText: '待更新',
        stabilityText: '待更新',
        controlText: '待更新',
        durationMetricText: '待更新',
        adviceSummary: [],
        videoReview: null,
        videoExpanded: false,
        videoLoadFailed: false,
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
        this.setData({
            videoId,
            statusBarHeight,
            showSafetyNotice,
        });
        try {
            const report = await (0, report_1.getReport)(videoId);
            const actionLabel = ACTION_LABEL_MAP[report.actionType] || '本次训练';
            const shouldShowControlMetric = report.actionType !== 'pelvic_tilt';
            const reportFocusTitle = report.reportFocus === 'review_pending'
                ? '本次结果待复核'
                : report.reportFocus === 'retake_recommended'
                    ? '建议重新拍摄'
                    : report.reportFocus === 'build_stability'
                        ? '本次继续练稳定'
                        : report.reportFocus === 'maintain_rhythm'
                            ? '这次完成得很稳'
                            : '本次先熟悉动作';
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
                reportFocusTitle,
                reportFocusText: report.reportFocusText || '',
                compareToLastText: report.compareToLast || '',
                validRepsText: `${report.validReps} / ${report.totalReps}`,
                holdDurationText: report.avgHoldDuration ? `${Math.round(report.avgHoldDuration)} 秒` : '待更新',
                accuracyText: report.accuracyAvg != null ? `${Math.round(report.accuracyAvg)}` : '待更新',
                stabilityText: report.stabilityAvg != null ? `${Math.round(report.stabilityAvg)}` : '待更新',
                controlText: report.controlAvg != null ? `${Math.round(report.controlAvg)}` : '待更新',
                durationMetricText: report.durationAvg != null ? `${Math.round(report.durationAvg)}` : '待更新',
                showControlMetric: shouldShowControlMetric,
                adviceSummary: report.adviceSummary || [],
                videoReview: report.videoReview || null,
                videoExpanded: false,
                videoLoadFailed: false,
                improvementMessage: report.motivation?.improvementMessage || report.trendSummary || '',
                newlyUnlockedBadges: report.newlyUnlockedBadges || [],
            });
        }
        catch (_error) {
            try {
                const status = await (0, video_1.getVideoStatus)(videoId);
                const isAnalysisFailed = status.status === 'failed' || status.status === 'quality_insufficient';
                if (isAnalysisFailed) {
                    const trunkKeypointsUnstable = `${status.failReason || ''}`.includes('关键躯干点') || `${status.failReason || ''}`.includes('肩髋');
                    this.setData({
                        loadFailed: false,
                        isAnalysisFailed: true,
                        failureTitle: status.status === 'quality_insufficient'
                            ? (trunkKeypointsUnstable ? '拍摄画面暂不适合评估' : '视频质量不足，暂未生成报告')
                            : '本次训练暂未生成结果',
                        failureReason: status.status === 'quality_insufficient'
                            ? (trunkKeypointsUnstable
                                ? '部分画面未能稳定识别到肩部或髋部。请将肩膀到髋部完整拍入画面，避免动作中移出镜头或被遮挡后重新上传。'
                                : (status.failReason || '请确保动作完整入镜、画面清晰稳定后再重新上传。'))
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
    onToggleVideo() {
        if (!this.data.videoReview || this.data.videoLoadFailed) {
            return;
        }
        this.setData({ videoExpanded: !this.data.videoExpanded });
    },
    onVideoError() {
        this.setData({ videoLoadFailed: true, videoExpanded: false });
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
});
