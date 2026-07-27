"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const appConfig_1 = require("../../services/appConfig");
const session_1 = require("../../store/session");
const video_1 = require("../../services/video");
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 3 * 60 * 1000;
function getAppConfig() {
    const app = getApp();
    return app.globalData.appConfig || appConfig_1.DEFAULT_APP_CONFIG;
}
let pollTimer;
let redirectTimer;
function getStatusLabel(status, failed, timeoutReached) {
    if (status === 'completed') {
        return '分析完成';
    }
    if (status === 'review_required') {
        return '结果待复核';
    }
    if (status === 'processing') {
        return '分析中';
    }
    if (status === 'queued') {
        return '排队中';
    }
    if (timeoutReached) {
        return '等待较久';
    }
    if (failed) {
        return '需要重新提交';
    }
    return '准备中';
}
function buildStatusSteps(status) {
    if (status === 'review_required') {
        return [
            { label: '接收视频', state: 'done' },
            { label: '质量检测', state: 'done' },
            { label: '动作分析', state: 'done' },
            { label: '结果复核', state: 'active' },
        ];
    }
    if (status === 'completed') {
        return [
            { label: '接收视频', state: 'done' },
            { label: '质量检测', state: 'done' },
            { label: '动作分析', state: 'done' },
            { label: '生成报告', state: 'done' },
        ];
    }
    if (status === 'processing') {
        return [
            { label: '接收视频', state: 'done' },
            { label: '质量检测', state: 'done' },
            { label: '动作分析', state: 'active' },
            { label: '生成报告', state: 'pending' },
        ];
    }
    if (status === 'quality_insufficient' || status === 'failed') {
        return [
            { label: '接收视频', state: 'done' },
            { label: '质量检测', state: status === 'quality_insufficient' ? 'warn' : 'done' },
            { label: '动作分析', state: status === 'failed' ? 'warn' : 'pending' },
            { label: '生成报告', state: 'pending' },
        ];
    }
    return [
        { label: '接收视频', state: 'done' },
        { label: '质量检测', state: 'active' },
        { label: '动作分析', state: 'pending' },
        { label: '生成报告', state: 'pending' },
    ];
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        videoId: 0,
        title: '系统正在分析您的动作',
        tip: '通常需要 1~2 分钟，请耐心等待。',
        status: 'queued',
        statusLabel: '排队中',
        failed: false,
        timeoutReached: false,
        showHistoryAction: false,
        pollStartedAt: 0,
        statusSteps: [
            { label: '接收视频', state: 'done' },
            { label: '质量检测', state: 'active' },
            { label: '动作分析', state: 'pending' },
            { label: '生成报告', state: 'pending' },
        ],
        failReasonTitle: '',
        failReasonDesc: '',
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    onLoad(query) {
        const sysInfo = wx.getSystemInfoSync();
        const statusBarHeight = sysInfo.statusBarHeight || 20;
        const videoId = Number(query.videoId || 0);
        this.setData({ videoId, pollStartedAt: Date.now(), statusBarHeight });
        this.updateTopPlaceholderHeight();
        this.pollStatus();
        pollTimer = setInterval(() => this.pollStatus(), POLL_INTERVAL_MS);
    },
    onUnload() {
        this.stopPolling();
        this.stopRedirect();
    },
    updateTopPlaceholderHeight() {
        wx.nextTick(() => {
            const query = wx.createSelectorQuery();
            query
                .select('.az-top-sticky')
                .boundingClientRect((rect) => {
                if (rect?.height) {
                    this.setData({ topPlaceholderHeight: Math.ceil(rect.height) });
                }
            })
                .exec();
        });
    },
    stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
        }
    },
    stopRedirect() {
        if (redirectTimer) {
            clearTimeout(redirectTimer);
            redirectTimer = undefined;
        }
    },
    async pollStatus() {
        if (!this.data.videoId) {
            return;
        }
        const elapsed = Date.now() - (this.data.pollStartedAt || Date.now());
        if (elapsed >= MAX_WAIT_MS && !this.data.timeoutReached) {
            this.stopPolling();
            this.setData({
                timeoutReached: true,
                failed: false,
                showHistoryAction: true,
                title: '分析时间比预期稍长',
                tip: '您可以稍后到历史记录里继续查看结果，无需重复上传。',
                statusLabel: getStatusLabel(this.data.status, false, true),
            });
            return;
        }
        try {
            const result = await (0, video_1.getVideoStatus)(this.data.videoId);
            const failed = result.status === 'failed' || result.status === 'quality_insufficient';
            const timeoutReached = this.data.timeoutReached;
            const title = result.status === 'review_required'
                ? '本次训练结果待复核'
                : result.status === 'completed'
                ? '本次训练分析完成'
                : failed
                    ? result.status === 'quality_insufficient'
                        ? '视频质量不足，暂时无法分析'
                        : '本次分析未成功'
                    : timeoutReached
                        ? '分析时间比预期稍长'
                        : '系统正在分析您的动作';
            const tip = result.status === 'review_required'
                ? '系统正在复核拍摄和动作信息，正在为您打开说明。'
                : result.status === 'completed'
                ? '分析完成，正在跳转报告页...'
                : failed
                    ? result.status === 'quality_insufficient'
                        ? '请确保动作完整入镜、光线清晰后重新上传。'
                        : '系统暂未完成本次分析，您可以重新上传一次继续训练。'
                    : timeoutReached
                        ? '您可以稍后到历史记录里查看结果。'
                        : '系统正在分析您的动作，请耐心等待。';
            this.setData({
                status: result.status,
                failed,
                timeoutReached,
                showHistoryAction: timeoutReached || failed,
                title,
                tip,
                statusLabel: getStatusLabel(result.status, failed, timeoutReached),
                statusSteps: buildStatusSteps(result.status),
                failReasonTitle: failed
                    ? result.status === 'quality_insufficient'
                        ? '视频质量不足'
                        : result.failReason?.slice(0, 50) || '分析失败'
                    : '',
                failReasonDesc: failed
                    ? result.status === 'quality_insufficient'
                        ? '请确保动作完整入镜、光线清晰后重新上传。'
                        : result.failReason || '分析过程中遇到问题，请稍后重试或重新上传。'
                    : '',
            });
            if (failed) {
                this.stopPolling();
                this.stopRedirect();
                wx.redirectTo({ url: `/pages/report/index?videoId=${this.data.videoId}` });
                return;
            }
            if ((result.status === 'completed' || result.status === 'review_required') && result.reportReady) {
                this.stopPolling();
                this.stopRedirect();
                const elapsedMs = Date.now() - (this.data.pollStartedAt || Date.now());
                const cfg = getAppConfig();
                const minAnalyzingPageMs = cfg.analyzingMinWaitSeconds * 1000;
                const delayMs = Math.max(0, minAnalyzingPageMs - elapsedMs);
                redirectTimer = setTimeout(() => {
                    wx.redirectTo({
                        url: `/pages/report/index?videoId=${this.data.videoId}`,
                    });
                }, delayMs);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const isAuthError = message.includes('401') || message.includes('Unauthorized');
            if (isAuthError) {
                // 401 重登录失败：不清求了，提示用户可以稍后查看
                this.stopPolling();
                this.setData({
                    title: '登录状态已过期',
                    tip: '您可以返回首页重新进入，或稍后到历史记录里查看分析结果。',
                    failed: true,
                    showHistoryAction: true,
                    statusLabel: '需要重新登录',
                });
            }
            else if (!this.data.timeoutReached) {
                // 非认证错误且未超时：继续轮询，不在第一次失败就停掉
                // 仅更新提示文字，让用户知道暂时获取不到状态
                this.setData({
                    tip: '暂时无法获取分析状态，系统仍在后台处理中，请稍候...',
                });
            }
            else {
                // 已超时且又出错了：停掉
                this.stopPolling();
                this.setData({
                    title: '状态获取失败',
                    tip: '当前无法确认分析状态，您可以稍后到历史记录里查看，或重新上传一次。',
                    failed: true,
                    showHistoryAction: true,
                    statusLabel: '需要重新提交',
                });
            }
        }
    },
    onRetryUpload() {
        const recentUploadMeta = (0, session_1.getRecentUploadMeta)(this.data.videoId);
        const actionQuery = recentUploadMeta?.actionType
            ? `?actionType=${recentUploadMeta.actionType}`
            : '';
        wx.redirectTo({ url: `/pages/upload/index${actionQuery}` });
    },
    onViewHistory() {
        wx.redirectTo({ url: '/pages/history/index' });
    },
    onBackHomeWait() {
        wx.redirectTo({ url: '/pages/index/index' });
    },
});
