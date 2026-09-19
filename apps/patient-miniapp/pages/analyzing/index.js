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
let isPolling = false;
function parseActionType(value) {
    return ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'].includes(value)
        ? value
        : '';
}
function getStatusLabel(status, progressStage, failed, timeoutReached, confirming) {
    if (confirming) {
        return '确认视频中';
    }
    if (status === 'completed') {
        return '分析完成';
    }
    if (status === 'review_required') {
        return '结果待复核';
    }
    if (timeoutReached) {
        return '等待较久';
    }
    if (failed) {
        return '需要重新提交';
    }
    const stageLabels = {
        waiting_for_worker: '等待分析资源',
        quality_check: '检查视频质量',
        keypoint_extraction: '分析动作',
        motion_analysis: '分析动作',
        report_generation: '生成报告',
    };
    return stageLabels[progressStage] || (status === 'queued' ? '等待分析资源' : '准备中');
}
function getProgressPresentation(status, progressStage, failed, timeoutReached, confirming) {
    if (confirming) {
        return { title: '正在确认您的视频', subtitle: '正在核对上传文件并创建分析任务。' };
    }
    if (status === 'completed') {
        return { title: '本次训练分析完成', subtitle: '报告已生成，正在为您打开。' };
    }
    if (status === 'review_required') {
        return { title: '正在复核本次训练结果', subtitle: '报告已生成，系统正在确认拍摄和动作信息。' };
    }
    if (failed) {
        return { title: '本次分析未完成', subtitle: '请查看下方原因，并按提示重新提交。' };
    }
    if (timeoutReached) {
        return { title: '分析时间比预期稍长', subtitle: '视频已保存，您可以稍后从历史记录查看结果。' };
    }
    const presentations = {
        waiting_for_worker: { title: '正在等待分析资源', subtitle: '视频已收到，系统即将开始处理。' },
        quality_check: { title: '正在检查视频质量', subtitle: '正在核对视频完整性、清晰度和入镜情况。' },
        keypoint_extraction: { title: '正在分析您的动作', subtitle: '正在逐帧识别身体姿态、动作节奏、幅度与稳定性。' },
        motion_analysis: { title: '正在分析您的动作', subtitle: '正在识别动作节奏、幅度与稳定性。' },
        report_generation: { title: '正在生成训练报告', subtitle: '正在整理本次动作分析结果和训练建议。' },
    };
    return presentations[progressStage] || presentations.waiting_for_worker;
}
function failurePresentation(status, failReason) {
const reason = `${failReason || ''}`.toLowerCase();
if (status === 'quality_insufficient') {
const uploadIncomplete = reason.includes('视频上传不完整')
|| reason.includes('视频文件信息不一致')
|| reason.includes('缺少原视频文件大小');
if (uploadIncomplete) {
return {
title: '视频上传不完整',
tip: '手机原文件大小与服务器收到的文件不一致，系统没有开始分析。',
action: '请检查网络后从相册重新选择原视频并上传，不要使用聊天软件转发或剪辑过程中生成的临时文件。',
};
}
const incompleteDecode = reason.includes('视频解码不完整') || reason.includes('video_decode_incomplete');
if (incompleteDecode) {
return {
title: '视频文件不完整',
tip: '视频时长信息与实际可读取画面不一致，继续分析会遗漏部分动作。',
action: '请从相册重新选择原视频，确认预览可以完整播放后再上传；不要使用聊天软件转发或剪辑过程中生成的临时文件。',
};
}
const trunkKeypointsUnstable = reason.includes('关键躯干点') || reason.includes('肩髋');
return trunkKeypointsUnstable
? {
title: '拍摄画面暂不适合评估',
tip: '部分画面未能稳定识别到肩部或髋部，暂时无法可靠分析本次动作。',
action: '请将肩膀到髋部完整拍入画面，动作过程中保持身体不移出镜头，并避免遮挡后重新上传。',
}
: {
title: '视频质量不足',
tip: '请确保动作完整入镜、光线清晰后重新上传。',
action: '请回到指导页确认拍摄角度、入镜范围和光线，再重新上传。',
};
}

    if (reason.includes('analysis_queue_unavailable') || reason.includes('分析服务')) {
        return {
            title: '分析服务暂时繁忙',
            tip: '视频已经保存，不需要重新拍摄。请稍后到训练记录查看，系统恢复后可再次提交。',
            action: '建议等待几分钟后从训练记录重新查看；如果仍未恢复，再重新上传。',
        };
    }
    if (reason.includes('视频文件尚未上传')) {
        return {
            title: '视频上传未完成',
            tip: '视频文件可能未完整传到服务器，请重新上传这一段视频。',
            action: '请检查网络连接后重新上传。',
        };
    }
    return {
        title: '本次分析未成功',
        tip: '视频已经保存，但本次分析没有完成。您可以稍后在训练记录中查看或重新上传。',
        action: '建议先稍后查看训练记录；若仍未生成结果，再重新上传。',
    };
}
function buildStatusSteps(status, progressStage) {
    const steps = [
        { label: '接收视频', state: 'done' },
        { label: '等待分析资源', state: 'pending' },
        { label: '检查视频质量', state: 'pending' },
        { label: '分析动作', state: 'pending' },
        { label: '生成报告', state: 'pending' },
    ];
    const activeIndexByStage = {
        waiting_for_worker: 1,
        quality_check: 2,
        keypoint_extraction: 3,
        motion_analysis: 3,
        report_generation: 4,
    };
    if (status === 'completed') {
        return steps.map((step) => ({ ...step, state: 'done' }));
    }
    if (status === 'review_required') {
        return [
            ...steps.map((step) => ({ ...step, state: 'done' })),
            { label: '结果复核', state: 'active' },
        ];
    }
    if (status === 'quality_insufficient') {
        return steps.map((step, index) => ({
            ...step,
            state: index < 2 ? 'done' : index === 2 ? 'warn' : 'pending',
        }));
    }
    const activeIndex = activeIndexByStage[progressStage] ?? 1;
    return steps.map((step, index) => ({
        ...step,
        state: index < activeIndex ? 'done' : index === activeIndex ? (status === 'failed' ? 'warn' : 'active') : 'pending',
    }));
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        videoId: 0,
        actionType: '',
        duration: 0,
        fileSizeBytes: 0,
        confirmingUpload: false,
        confirmStarted: false,
        title: '正在等待分析资源',
        tip: '视频已收到，系统即将开始处理。',
        status: 'queued',
        progressStage: 'waiting_for_worker',
        statusLabel: '等待分析资源',
        failed: false,
        canRetryUpload: false,
        canRetryConfirm: false,
        timeoutReached: false,
        showHistoryAction: false,
        pollStartedAt: 0,
        statusSteps: buildStatusSteps('queued', 'waiting_for_worker'),
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
        const actionType = parseActionType(query.actionType);
        const duration = Number(query.duration || 0);
        const fileSizeBytes = Number(query.fileSizeBytes || 0);
        const hasValidFileSize = Number.isSafeInteger(fileSizeBytes) && fileSizeBytes > 0;
        const shouldConfirmUpload = Boolean(videoId && actionType && duration > 0 && hasValidFileSize);
        const requiresReselect = Boolean(videoId && actionType && duration > 0 && !hasValidFileSize);
        this.setData({
            videoId,
            actionType,
            duration,
            fileSizeBytes,
            confirmingUpload: shouldConfirmUpload,
            confirmStarted: false,
            pollStartedAt: Date.now(),
            statusBarHeight,
            failed: requiresReselect,
            canRetryUpload: requiresReselect,
            showHistoryAction: requiresReselect,
            title: requiresReselect
                ? '需要重新选择视频'
                : shouldConfirmUpload ? '正在确认您的视频' : '正在等待分析资源',
            tip: requiresReselect
                ? '无法确认原视频文件大小。为确保上传完整，请从相册重新选择原视频后再上传。'
                : shouldConfirmUpload
                    ? '视频已上传，正在创建分析任务，请稍候。'
                    : '视频已收到，系统即将开始处理。',
            statusLabel: requiresReselect
                ? '需要重新上传'
                : getStatusLabel('queued', 'waiting_for_worker', false, false, shouldConfirmUpload),
            progressStage: 'waiting_for_worker',
            statusSteps: buildStatusSteps('queued', 'waiting_for_worker'),
            failReasonTitle: requiresReselect ? '无法校验视频完整性' : '',
            failReasonDesc: requiresReselect ? '请重新选择原视频并完成上传。' : '',
        });
        this.updateTopPlaceholderHeight();
        if (shouldConfirmUpload) {
            void this.confirmUploadedVideo();
        }
        this.pollStatus();
        pollTimer = setInterval(() => this.pollStatus(), POLL_INTERVAL_MS);
    },
    onUnload() {
        this.stopPolling();
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
    async confirmUploadedVideo() {
        if (this.data.confirmStarted || !this.data.videoId || !this.data.actionType || this.data.duration <= 0
            || !Number.isSafeInteger(this.data.fileSizeBytes) || this.data.fileSizeBytes <= 0) {
            return;
        }
        this.setData({ confirmStarted: true, confirmingUpload: true });
        try {
            const confirmed = await (0, video_1.confirmUpload)({
                videoId: this.data.videoId,
                actionType: this.data.actionType,
                duration: this.data.duration,
                fileSizeBytes: this.data.fileSizeBytes,
            });
            this.setData({
                confirmingUpload: false,
                canRetryConfirm: false,
                title: confirmed.status === 'completed' ? '本次训练分析完成' : '正在等待分析资源',
                tip: confirmed.status === 'completed'
                    ? '分析完成，正在打开报告页…'
                    : '视频已收到，正在等待系统开始处理。',
                progressStage: confirmed.status === 'completed' ? 'report_ready' : 'waiting_for_worker',
                statusLabel: getStatusLabel(confirmed.status, confirmed.status === 'completed' ? 'report_ready' : 'waiting_for_worker', false, false, false),
                statusSteps: buildStatusSteps(confirmed.status, confirmed.status === 'completed' ? 'report_ready' : 'waiting_for_worker'),
            });
            if (confirmed.status === 'completed') {
                wx.redirectTo({ url: `/pages/report/index?videoId=${this.data.videoId}` });
                return;
            }
            // 首次确认失败后轮询已停止；用户点击“重新创建分析任务”成功时恢复轮询。
            this.pollStatus();
            if (!pollTimer) {
                pollTimer = setInterval(() => this.pollStatus(), POLL_INTERVAL_MS);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const isAuthError = message.includes('401') || message.includes('Unauthorized');
            const uploadIntegrityFailed = message.includes('视频上传不完整')
                || message.includes('视频文件信息不一致')
                || message.includes('缺少原视频文件大小');
            const shouldKeepPolling = !isAuthError && !uploadIntegrityFailed;
            if (!shouldKeepPolling) {
                this.stopPolling();
            }
            this.setData({
                confirmingUpload: false,
                confirmStarted: false,
                // 确认接口的临时故障不会丢失视频，后台补偿可能已成功入队；不能把页面固定在失败态。
                failed: !shouldKeepPolling,
                canRetryUpload: uploadIntegrityFailed,
                canRetryConfirm: false,
                showHistoryAction: true,
                status: shouldKeepPolling ? 'queued' : this.data.status,
                progressStage: shouldKeepPolling ? 'waiting_for_worker' : this.data.progressStage,
                title: isAuthError
                    ? '登录状态已过期'
                    : uploadIntegrityFailed
                        ? '视频上传不完整'
                        : '正在等待系统创建分析任务',
                tip: isAuthError
                    ? '请重新登录后到训练记录查看此视频。'
                    : uploadIntegrityFailed
                        ? '为避免漏掉动作，系统没有开始分析。请从相册重新选择原视频后再次上传。'
                        : '视频已保存，系统正在后台恢复分析任务；页面会自动更新进度。',
                statusLabel: isAuthError
                    ? '需要重新登录'
                    : uploadIntegrityFailed
                        ? '需要重新上传'
                        : '等待系统重试',
                statusSteps: shouldKeepPolling
                    ? buildStatusSteps('queued', 'waiting_for_worker')
                    : this.data.statusSteps,
                failReasonTitle: isAuthError
                    ? '登录状态已过期'
                    : uploadIntegrityFailed ? '无法确认上传完整性' : '',
                failReasonDesc: isAuthError
                    ? '请重新登录后重试。'
                    : uploadIntegrityFailed ? '请重新选择原始相册视频并上传。' : '',
            });
            if (shouldKeepPolling) {
                this.pollStatus();
                if (!pollTimer) {
                    pollTimer = setInterval(() => this.pollStatus(), POLL_INTERVAL_MS);
                }
            }
        }
    },
    async pollStatus() {
        if (!this.data.videoId || isPolling || this.data.confirmingUpload) {
            return;
        }
        isPolling = true;
        const elapsed = Date.now() - (this.data.pollStartedAt || Date.now());
        if (elapsed >= MAX_WAIT_MS && !this.data.timeoutReached) {
            this.stopPolling();
            this.setData({
                timeoutReached: true,
                failed: false,
                showHistoryAction: true,
                title: '分析时间比预期稍长',
                tip: '您可以稍后到历史记录里继续查看结果，无需重复上传。',
                statusLabel: getStatusLabel(this.data.status, this.data.progressStage, false, true, false),
            });
            isPolling = false;
            return;
        }
        try {
            const result = await (0, video_1.getVideoStatus)(this.data.videoId);
            const failed = result.status === 'failed' || result.status === 'quality_insufficient';
            const timeoutReached = this.data.timeoutReached;
            const failure = failed ? failurePresentation(result.status, result.failReason) : null;
            const progressStage = result.progressStage || (result.status === 'processing' ? 'quality_check' : 'waiting_for_worker');
            const presentation = getProgressPresentation(result.status, progressStage, failed, timeoutReached, false);
            const title = failed ? failure.title : presentation.title;
            const tip = failed ? failure.tip : presentation.subtitle;
            this.setData({
                status: result.status,
                progressStage,
                failed,
                canRetryUpload: failed,
                canRetryConfirm: false,
                timeoutReached,
                showHistoryAction: timeoutReached || failed,
                title,
                tip,
                statusLabel: getStatusLabel(result.status, progressStage, failed, timeoutReached, false),
                statusSteps: buildStatusSteps(result.status, progressStage),
                failReasonTitle: failed ? failure.title : '',
                failReasonDesc: failed ? failure.action : '',
            });
            if (failed) {
                this.stopPolling();
                wx.redirectTo({ url: `/pages/report/index?videoId=${this.data.videoId}` });
                return;
            }
            if ((result.status === 'completed' || result.status === 'review_required') && result.reportReady) {
                this.stopPolling();
                wx.redirectTo({ url: `/pages/report/index?videoId=${this.data.videoId}` });
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
                    canRetryUpload: false,
                    canRetryConfirm: false,
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
                    canRetryUpload: true,
                    canRetryConfirm: false,
                    showHistoryAction: true,
                    statusLabel: '需要重新提交',
                });
            }
        }
        finally {
            isPolling = false;
        }
    },
    onRetryConfirmUpload() {
        if (!this.data.canRetryConfirm) {
            return;
        }
        this.setData({
            failed: false,
            canRetryConfirm: false,
            confirmingUpload: true,
            title: '正在确认您的视频',
            tip: '正在重新创建分析任务，请稍候。',
            progressStage: 'waiting_for_worker',
            statusLabel: getStatusLabel('queued', 'waiting_for_worker', false, false, true),
            statusSteps: buildStatusSteps('queued', 'waiting_for_worker'),
        });
        void this.confirmUploadedVideo();
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
        // 返回首页表示暂时离开本次训练流程；清空“指导 → 上传 → 分析”的页面栈，
        // 避免用户再侧滑返回到已完成上传的指导页而误以为需要继续该流程。
        wx.reLaunch({ url: '/pages/index/index' });
    },
});
