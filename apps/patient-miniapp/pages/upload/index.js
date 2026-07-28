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
function formatFileSize(size) {
    if (!size) {
        return '未知大小';
    }
    if (size < 1024 * 1024) {
        return `${Math.round(size / 1024)}KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)}MB`;
}
function getMaxDurationSeconds(source) {
    const cfg = getAppConfig();
    return source === 'camera' ? cfg.videoRecordMaxDurationSeconds : cfg.videoMaxDurationSeconds;
}
function buildCheckItems(duration, size, extension, source) {
    const cfg = getAppConfig();
    const maxBytes = cfg.videoMaxSizeMB * 1024 * 1024;
    const maxDuration = getMaxDurationSeconds(source);
    return [
        {
            label: '视频时长',
            value: duration >= cfg.videoMinDurationSeconds && duration <= maxDuration ? `已录制 ${duration} 秒` : '时长需重新确认',
            passed: duration >= cfg.videoMinDurationSeconds && duration <= maxDuration,
        },
        {
            label: '文件大小',
            value: size <= maxBytes ? `文件 ${formatFileSize(size)}` : '文件超过限制',
            passed: size <= maxBytes,
        },
        {
            label: '文件格式',
            value: ALLOWED_VIDEO_EXTENSIONS.includes(extension) ? extension.replace('.', '').toUpperCase() : '格式不支持',
            passed: ALLOWED_VIDEO_EXTENSIONS.includes(extension),
        },
    ];
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
        selectedFileSize: '',
        validationMessage: '',
        actionOptions: [],
        goalDesc: '本次先完成「缩腹运动」1 次，动作稳一点比做得快更重要。',
        previewPoster: '',
        checkItems: [],
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
        if (!nextValue || nextValue === this.data.actionType) {
            return;
        }
        const options = (this.data.actionOptions || []);
        if (!options.some((item) => item.value === nextValue)) {
            return;
        }
        this.setData({
            ...buildActionState(nextValue, options),
            statusText: this.data.filePath ? '动作已切换，视频需重新确认后再提交。' : '动作已切换，请继续选择本次训练视频。',
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
                statusText: '请重新选择符合格式要求的视频。',
            });
            wx.showToast({ title: '视频格式不支持', icon: 'none' });
            return;
        }
        if (res.duration < cfg.videoMinDurationSeconds) {
            this.setData({
                validationMessage: `视频时长过短，请至少保留 ${cfg.videoMinDurationSeconds} 秒完整动作。`,
                canSubmit: false,
                statusText: '请重新选择更完整的训练视频。',
            });
            wx.showToast({ title: '视频时长过短', icon: 'none' });
            return;
        }
        if (res.duration > maxDuration) {
            this.setData({
                validationMessage: `视频时长超过 ${Math.floor(maxDuration / 60)} 分钟，请裁剪后再上传。`,
                canSubmit: false,
                statusText: '请重新选择更短的视频后再提交分析。',
            });
            wx.showToast({ title: '视频时长过长', icon: 'none' });
            return;
        }
        if (size > maxBytes) {
            this.setData({
                validationMessage: `视频文件超过 ${cfg.videoMaxSizeMB}MB，请压缩或裁剪后再上传。`,
                canSubmit: false,
                statusText: '当前视频体积较大，请重新处理后再上传。',
            });
            wx.showToast({ title: '视频文件过大', icon: 'none' });
            return;
        }
        this.setData({
            filePath: res.tempFilePath,
            fileName: getFileName(res.tempFilePath),
            selectedFileSize: formatFileSize(size),
            validationMessage: '',
            duration: res.duration,
            durationText: formatDuration(res.duration),
            canSubmit: true,
            statusText: sourceLabel === 'camera'
                ? '录制完成，点击“提交分析”继续。'
                : sourceLabel === 'album'
                    ? '视频已从相册选择，点击“提交分析”继续。'
                    : '视频已选择，点击“提交分析”继续。',
            previewPoster: res.tempFilePath,
            checkItems: buildCheckItems(res.duration, size, extension, sourceLabel),
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
            wx.showToast({ title: '选择视频失败', icon: 'none' });
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
            const presign = await (0, video_1.getPresignUpload)();
            (0, session_1.saveRecentUploadMeta)({
                videoId: presign.videoId,
                actionType: this.data.actionType,
                duration: this.data.duration || 0,
                updatedAt: Date.now(),
            });
            this.setData({ statusText: '正在上传视频，请稍候...' });
            await (0, video_1.uploadVideoFile)(presign.videoId, presign, this.data.filePath);
            this.setData({ statusText: '视频上传完成，正在进入分析页面...' });
            wx.navigateTo({
                url: `/pages/analyzing/index?videoId=${presign.videoId}`,
                success: () => {
                    // 上传已完成；确认文件、登记训练记录和投递分析任务在后台执行，避免阻塞用户进入分析页。
                    void (0, video_1.confirmUpload)({
                        videoId: presign.videoId,
                        actionType: this.data.actionType,
                        duration: this.data.duration || 30,
                    }).catch(() => {
                        // 服务端会记录确认或投递失败状态，分析页轮询后展示可重传的结果反馈。
                    });
                },
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '提交失败，请稍后重试。';
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
