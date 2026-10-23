"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const feedback_1 = require("../../services/feedback");
const report_1 = require("../../services/report");
const video_1 = require("../../services/video");
const videoFailure_1 = require("../../utils/videoFailure");
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
function formatPhaseSeconds(value) {
    return `${Number(value).toFixed(1)} 秒`;
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
        failureCanRetryUpload: false,
        failureNeedsGuidance: false,
        feedbackEntryLoading: false,
        activeFeedbackId: 0,
        feedbackEntryLabel: '提交反馈',
        videoId: 0,
        grade: '',
        averageScore: 0,
        requiresManualReview: false,
        reviewMessage: '',
        observedReps: 0,
        isVisualPractice: false,
        showVisualScore: false,
        scoreAvailable: true,
        practiceCountText: '0 次',
        visualPhaseMetricsAvailable: false,
        riseTimeText: '--',
        peakTimeText: '--',
        returnTimeText: '--',
        cycleDurationText: '--',
        actionLabel: '本段动作',
        actionType: 'abdominal_crunch',
        reportFocusTitle: '本段先熟悉动作',
        reportFocusText: '',
        validRepsText: '0 / 0',
        holdDurationText: '0 秒',
        accuracyText: '-',
        stabilityText: '-',
        controlText: '-',
        durationMetricText: '-',
        adviceSummary: [],
        videoReview: null,
        videoExpanded: false,
        videoLoadFailed: false,
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
        const videoId = Number(query.videoId);
        const showSafetyNotice = query.safetyNotice === '1';
        this.setData({
            videoId,
            statusBarHeight,
            showSafetyNotice,
        });
        if (!Number.isSafeInteger(videoId) || videoId <= 0) {
          this.setData({
            loading: false,
            loadFailed: true,
            errorIcon: '⚠️',
            errorTitle: '报告链接无效',
            errorMessage: '请从训练历史中重新打开这条记录。',
          });
          this.updateTopPlaceholderHeight();
          return;
        }
        try {
            const report = await (0, report_1.getReport)(videoId);
            const actionLabel = ACTION_LABEL_MAP[report.actionType] || '本段动作';
            const isVisualPractice = report.scoreType === 'visual_practice' || report.scoreType === 'visual_evidence';
            const showVisualScore = report.scoreType === 'visual_evidence' && report.scoreAvailable !== false;
            const visualMetrics = isVisualPractice ? report.visualPhaseMetrics : null;
            const visualPhaseMetricsAvailable = Boolean(visualMetrics && [
                visualMetrics.riseSeconds, visualMetrics.holdSeconds,
                visualMetrics.returnSeconds, visualMetrics.smoothnessPercent,
            ].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0));
            // 新旧报告可能都包含整套训练趋势/进步评价；短片段不能据此推断整套训练效果。
            const shouldShowControlMetric = report.actionType !== 'pelvic_tilt';
            const reportFocusTitle = isVisualPractice
                ? '本次练习已记录'
                : report.reportFocus === 'review_pending'
                ? '本段结果待复核'
                : report.reportFocus === 'retake_recommended'
                    ? '建议重新拍摄'
                    : report.reportFocus === 'build_stability'
                        ? '本段继续练稳定'
                        : report.reportFocus === 'maintain_rhythm'
                            ? '本段动作较稳'
                            : '本段先熟悉动作';
            this.setData({
                loadFailed: false,
                isAnalysisFailed: false,
                errorMessage: '',
                grade: report.grade,
                averageScore: showVisualScore ? Math.round(report.averageScore) : report.averageScore,
                requiresManualReview: Boolean(report.requiresManualReview),
                reviewMessage: report.reviewMessage || '',
                observedReps: Number(report.observedReps) || 0,
                isVisualPractice,
                showVisualScore,
                scoreAvailable: report.scoreAvailable !== false,
                practiceCountText: `${Number(report.totalReps) || 0} 次`,
                visualPhaseMetricsAvailable,
                riseTimeText: visualPhaseMetricsAvailable ? formatPhaseSeconds(visualMetrics.riseSeconds) : '--',
                peakTimeText: visualPhaseMetricsAvailable ? formatPhaseSeconds(visualMetrics.holdSeconds) : '--',
                returnTimeText: visualPhaseMetricsAvailable ? formatPhaseSeconds(visualMetrics.returnSeconds) : '--',
                cycleDurationText: visualPhaseMetricsAvailable
                    ? formatPhaseSeconds(visualMetrics.riseSeconds + visualMetrics.holdSeconds + visualMetrics.returnSeconds) : '--',
                actionLabel,
                actionType: report.actionType,
                reportFocusTitle,
                reportFocusText: isVisualPractice
                    ? report.scoreAvailable === false ? '下次可拍下完整动作。' : '按舒适幅度，继续保持练习。'
                    : report.reportFocusText ? `本段动作观察：${report.reportFocusText}` : '本段视频仅用于观察动作，不代表整套训练表现。',
                validRepsText: `${report.validReps} / ${report.totalReps}`,
                holdDurationText: report.avgHoldDuration ? `${Math.round(report.avgHoldDuration)} 秒` : '-',
                accuracyText: report.accuracyAvg != null ? `${Math.round(report.accuracyAvg)}` : '-',
                stabilityText: report.stabilityAvg != null ? `${Math.round(report.stabilityAvg)}` : '-',
                controlText: report.controlAvg != null ? `${Math.round(report.controlAvg)}` : '-',
                durationMetricText: report.durationAvg != null ? `${Math.round(report.durationAvg)}` : '-',
                showControlMetric: shouldShowControlMetric,
                adviceSummary: report.adviceSummary || [],
                videoReview: report.videoReview || null,
                videoExpanded: false,
                videoLoadFailed: false,
                newlyUnlockedBadges: report.newlyUnlockedBadges || [],
            });
        }
        catch (_error) {
            try {
                const status = await (0, video_1.getVideoStatus)(videoId);
                const isAnalysisFailed = status.status === 'failed' || status.status === 'quality_insufficient';
                if (isAnalysisFailed) {
                    const failure = (0, videoFailure_1.getVideoFailurePresentation)(status.status, status.failReason);
                    this.setData({
                        loadFailed: false,
                        isAnalysisFailed: true,
                        failureTitle: failure.title,
                        failureReason: `${failure.tip} ${failure.action}`,
                        failureCanRetryUpload: Boolean(failure.canRetryUpload),
                        failureNeedsGuidance: Boolean(failure.showGuidanceAction),
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
        const previousPage = pages.length > 1 ? pages[pages.length - 2] : null;
        if (previousPage?.route === 'pages/guidance/detail') {
            wx.redirectTo({ url: '/pages/guidance/index' });
            return;
        }
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
    onViewGuidance() {
        wx.redirectTo({ url: `/pages/guidance/detail?actionType=${encodeURIComponent(this.data.actionType)}` });
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
