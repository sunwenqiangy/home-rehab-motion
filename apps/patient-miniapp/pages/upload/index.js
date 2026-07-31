"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const video_1 = require("../../services/video");
const appConfig_1 = require("../../services/appConfig");
const session_1 = require("../../store/session");
const ACTION_OPTION_META = {
    abdominal_crunch: {
        label: '缩腹运动',
        hint: '也可以切换为骨盆倾斜或膝关节旋转。',
    },
    pelvic_tilt: {
        label: '骨盆倾斜',
        hint: '也可以切换为缩腹运动或膝关节旋转。',
    },
    knee_rotation: {
        label: '膝关节旋转',
        hint: '也可以切换为缩腹运动或骨盆倾斜。',
    },
};
function buildActionOptions() {
    const cfg = getAppConfig();
    const supported = cfg.supportedActionTypes.length
        ? cfg.supportedActionTypes
        : ['abdominal_crunch'];
    return supported.map((actionType) => ({
        value: actionType,
        label: ACTION_OPTION_META[actionType]?.label || '训练动作',
        hint: ACTION_OPTION_META[actionType]?.hint || '可切换其他动作。',
    }));
}
function getActionOption(actionType, options) {
    return options.find((item) => item.value === actionType) || options[0];
}
function getActionIndex(actionType, options) {
    return options.findIndex((item) => item.value === actionType);
}
function buildActionState(actionType, options) {
    const actionOption = getActionOption(actionType, options);
    return {
        actionType: actionOption?.value || 'abdominal_crunch',
        selectedActionIndex: Math.max(getActionIndex(actionType, options), 0),
        actionLabel: actionOption?.label || '训练动作',
        actionHint: actionOption?.hint || '可切换其他动作。',
        goalDesc: `本次先完成「${actionOption?.label || '训练动作'}」1 次，动作稳一点比做得快更重要。`,
    };
}
const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.avi'];
function getAppConfig() {
    const app = getApp();
    return app.globalData.appConfig || appConfig_1.DEFAULT_APP_CONFIG;
}
function formatDuration(seconds) {
    if (!seconds) {
        return '未选择';
    }
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return remainSeconds ? `${minutes}分${remainSeconds}秒` : `${minutes}分`;
}
function getFileName(filePath) {
    const segments = filePath.split('/');
    return segments[segments.length - 1] || '已选择视频';
}
function getFileExtension(filePath) {
    const fileName = getFileName(filePath).toLowerCase();
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex >= 0 ? fileName.slice(dotIndex) : '';
}
function getMaxDurationSeconds(source) {
    const cfg = getAppConfig();
    return source === 'camera' ? cfg.videoRecordMaxDurationSeconds : cfg.videoMaxDurationSeconds;
}
function chooseTrainingVideo(sourceType = ['album', 'camera']) {
    const cfg = getAppConfig();
    const maxDuration = sourceType.length === 1 && sourceType[0] === 'camera'
        ? cfg.videoRecordMaxDurationSeconds
        : cfg.videoMaxDurationSeconds;
    return new Promise((resolve, reject) => {
        const chooseMedia = wx.chooseMedia;
        if (typeof chooseMedia === 'function') {
            chooseMedia({
                count: 1,
                mediaType: ['video'],
                sourceType,
                maxDuration,
                camera: 'back',
                success: (res) => {
                    const selected = res.tempFiles?.[0];
                    if (!selected?.tempFilePath) {
                        reject(new Error('NO_VIDEO_SELECTED'));
                        return;
                    }
                    resolve({
                        tempFilePath: selected.tempFilePath,
                        duration: Number(selected.duration || 0),
                        size: Number(selected.size || 0),
                    });
                },
                fail: reject,
            });
            return;
        }
        wx.chooseVideo({
            sourceType,
            maxDuration,
            camera: 'back',
            success: (res) => {
                resolve({
                    tempFilePath: res.tempFilePath,
                    duration: Number(res.duration || 0),
                    size: Number(res.size || 0),
                });
            },
            fail: reject,
        });
    });
}
function ensureLogin() {
    if ((0, session_1.getToken)()) {
        return true;
    }
    wx.showToast({ title: '登录后可上传训练视频', icon: 'none' });
    wx.reLaunch({ url: '/pages/auth/login' });
    return false;
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        actionType: 'abdominal_crunch',
        selectedActionIndex: 0,
        actionLabel: '缩腹运动',
        actionHint: '也可以切换为骨盆倾斜或膝关节旋转。',
        statusText: '上传前 30 秒自查：先看预览与检查结果，再提交可减少重复上传。',
        filePath: '',
        fileName: '',
        duration: 0,
        durationText: '未选择',
        canSubmit: false,
        submitting: false,
        validationMessage: '',
        actionOptions: [],
        goalDesc: '本次先完成「缩腹运动」1 次，动作稳一点比做得快更重要。',
        previewPoster: '',
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    async onLoad(query) {
        const loginOk = ensureLogin();
        if (!loginOk) {
            return;
        }
        try {
            const app = getApp();
            app.globalData.appConfig = await (0, appConfig_1.fetchAppConfig)();
        }
        catch (_error) {
            // 使用启动时或内置的兜底配置，避免配置接口短暂不可用阻塞上传。
        }
        const sysInfo = wx.getSystemInfoSync();
        const statusBarHeight = sysInfo.statusBarHeight || 20;
        const actionOptions = buildActionOptions();
        const queryActionType = query.actionType;
        const fallbackActionType = actionOptions[0]?.value || 'abdominal_crunch';
        const actionType = queryActionType && actionOptions.some((item) => item.value === queryActionType)
            ? queryActionType
            : fallbackActionType;
        this.setData({
            actionOptions,
            ...buildActionState(actionType, actionOptions),
            statusBarHeight,
        });
        this.updateTopPlaceholderHeight();
        const draft = (0, session_1.consumePendingUploadDraft)();
        if (draft) {
            const draftActionType = draft.actionType;
            const nextActionType = actionOptions.some((item) => item.value === draftActionType)
                ? draftActionType
                : fallbackActionType;
            this.setData({ ...buildActionState(nextActionType, actionOptions) });
            this.applySelectedVideo({
                tempFilePath: draft.tempFilePath,
                duration: Number(draft.duration || 0),
                size: Number(draft.size || 0),
            }, draft.source);
        }
    },
    updateTopPlaceholderHeight() {
        wx.nextTick(() => {
            const query = wx.createSelectorQuery();
            query
                .select('.upload-v4-top-sticky')
                .boundingClientRect((rect) => {
                if (rect?.height) {
                    this.setData({ topPlaceholderHeight: Math.ceil(rect.height) });
                }
            })
                .exec();
        });
    },
    onActionTap(event) {
        const nextValue = event.currentTarget.dataset.value;
        this.changeAction(nextValue);
    },
    onChangeAction() {
        const options = this.data.actionOptions || [];
        if (options.length < 2) {
            wx.showToast({ title: '当前仅支持这一种训练动作', icon: 'none' });
            return;
        }
        wx.showActionSheet({
            itemList: options.map((item) => item.label),
            success: (result) => {
                const nextAction = options[result.tapIndex];
                this.changeAction(nextAction?.value);
            },
        });
    },
    changeAction(nextValue) {
        if (!nextValue || nextValue === this.data.actionType) {
            return;
        }
        const options = this.data.actionOptions || [];
        if (!options.some((item) => item.value === nextValue)) {
            return;
        }
        const actionState = buildActionState(nextValue, options);
        const hasSelectedVideo = Boolean(this.data.filePath);
        this.setData({
            ...actionState,
            filePath: hasSelectedVideo ? '' : this.data.filePath,
            fileName: hasSelectedVideo ? '' : this.data.fileName,
            duration: hasSelectedVideo ? 0 : this.data.duration,
            durationText: hasSelectedVideo ? '未选择' : this.data.durationText,
            previewPoster: hasSelectedVideo ? '' : this.data.previewPoster,
            canSubmit: false,
            validationMessage: hasSelectedVideo ? `已切换为「${actionState.actionLabel}」，请重新选择对应动作的视频。` : '',
            statusText: hasSelectedVideo
                ? `已切换为「${actionState.actionLabel}」，为避免传错视频，请重新选择。`
                : `已切换为「${actionState.actionLabel}」，请选择对应动作的视频。`,
        });
    },
    applySelectedVideo(res, sourceLabel) {
        const extension = getFileExtension(res.tempFilePath);
        const size = Number(res.size || 0);
        const cfg = getAppConfig();
        const maxBytes = cfg.videoMaxSizeMB * 1024 * 1024;
        const maxDuration = getMaxDurationSeconds(sourceLabel);
        if (!ALLOWED_VIDEO_EXTENSIONS.includes(extension)) {
            this.setData({
                validationMessage: '当前仅支持 mp4、mov、m4v、avi 格式的视频。',
                canSubmit: false,
                statusText: '当前视频格式不支持，请重新选择。',
            });
            return;
        }
        if (res.duration < cfg.videoMinDurationSeconds) {
            this.setData({
                validationMessage: `视频时长过短，请至少保留 ${cfg.videoMinDurationSeconds} 秒完整动作。`,
                canSubmit: false,
                statusText: '当前视频时长不足，请重新选择。',
            });
            return;
        }
        if (res.duration > maxDuration) {
            this.setData({
                validationMessage: `视频时长超过 ${Math.floor(maxDuration / 60)} 分钟，请裁剪后再上传。`,
                canSubmit: false,
                statusText: '当前视频时长过长，请裁剪或重新选择。',
            });
            return;
        }
        if (size > maxBytes) {
            this.setData({
                validationMessage: `视频文件超过 ${cfg.videoMaxSizeMB}MB，请压缩或裁剪后再上传。`,
                canSubmit: false,
                statusText: '当前视频文件过大，请压缩或重新选择。',
            });
            return;
        }
        this.setData({
            filePath: res.tempFilePath,
            fileName: getFileName(res.tempFilePath),
            validationMessage: '',
            duration: res.duration,
            durationText: formatDuration(res.duration),
            canSubmit: true,
            statusText: '视频可以上传分析，请确认预览画面无误。',
            previewPoster: res.tempFilePath,
        });
    },
    onSelectVideo() {
        this.setData({ statusText: '正在打开视频选择，请稍候...' });
        chooseTrainingVideo()
            .then((res) => {
            this.applySelectedVideo(res);
        })
            .catch((error) => {
            const errorText = `${error?.errMsg || error?.message || ''}`;
            if (errorText.includes('cancel')) {
                this.setData({ statusText: '已取消选择视频，可再次点击“选择视频”。' });
                return;
            }
            if (errorText.includes('auth deny') || errorText.includes('auth denied') || errorText.includes('permission')) {
                this.setData({
                    validationMessage: '当前没有相册或相机权限，请开启后再选择视频。',
                    statusText: '未获取到视频访问权限，请先授权。',
                });
                wx.showModal({
                    title: '需要授权',
                    content: '请在设置中允许访问相册或相机，然后再选择视频。',
                    confirmText: '去设置',
                    success: (modalRes) => {
                        if (modalRes.confirm) {
                            wx.openSetting();
                        }
                    },
                });
                return;
            }
            this.setData({
                validationMessage: '暂时无法选择视频，请检查系统权限或稍后重试。',
                statusText: '视频选择失败，请稍后重试。',
            });
        });
    },
    async onSubmit() {
        if (!this.data.canSubmit || this.data.submitting) {
            return;
        }
        const loginOk = ensureLogin();
        if (!loginOk) {
            this.setData({
                statusText: '登录已过期，请重新点击"提交分析"。',
                validationMessage: '系统登录状态已过期，点击按钮即可自动重新登录。',
            });
            return;
        }
        this.setData({ submitting: true, statusText: '正在准备上传视频...' });
        try {
            const presign = await (0, video_1.getPresignUpload)(this.data.actionType);
            console.info('[视频上传目标]', {
                videoId: presign.videoId,
                uploadType: presign.uploadType,
                uploadUrl: presign.uploadUrl,
            });
            (0, session_1.saveRecentUploadMeta)({
                videoId: presign.videoId,
                actionType: this.data.actionType,
                duration: this.data.duration || 0,
                updatedAt: Date.now(),
            });
            this.setData({ statusText: '正在上传视频，请稍候...' });
            await (0, video_1.uploadVideoFile)(presign.videoId, presign, this.data.filePath);
            this.setData({ statusText: '视频上传完成，正在确认分析任务...' });
            const confirmed = await (0, video_1.confirmUpload)({
                videoId: presign.videoId,
                actionType: this.data.actionType,
                duration: this.data.duration || 30,
            });
            this.setData({ statusText: confirmed.status === 'completed' ? '分析已完成，正在打开报告...' : '已提交分析，正在进入分析页面...' });
            wx.redirectTo({
                url: confirmed.status === 'completed'
                    ? `/pages/report/index?videoId=${presign.videoId}`
                    : `/pages/analyzing/index?videoId=${presign.videoId}`,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '提交失败，请稍后重试。';
            console.error('[提交训练视频失败]', {
                error: message,
                apiBaseUrl: require('../../config/env').API_BASE_URL,
            });
            const isAuthError = message.includes('401') || message.includes('Unauthorized') || message.includes('登录');
            this.setData({
                statusText: isAuthError ? '登录状态已过期，请重新点击"提交分析"。' : '提交失败，请稍后重试。',
                validationMessage: isAuthError
                    ? '系统登录已过期，重新点击按钮即可自动恢复，无需重新选择视频。'
                    : `提交失败：${message}`,
            });
            wx.showToast({
                title: isAuthError ? '登录过期，请重试' : message.slice(0, 20),
                icon: 'none',
            });
        }
        finally {
            this.setData({ submitting: false });
        }
    },
    onGoBack() {
        if (getCurrentPages().length > 1) {
            wx.navigateBack({ delta: 1 });
            return;
        }
        wx.redirectTo({ url: '/pages/index/index' });
    },
});
