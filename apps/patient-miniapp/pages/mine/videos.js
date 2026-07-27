"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_1 = require("../../store/session");
const history_1 = require("../../services/history");
const ACTION_LABEL_MAP = {
    abdominal_crunch: '缩腹运动',
    pelvic_tilt: '骨盆倾斜',
    knee_rotation: '膝关节旋转',
};
const STATUS_LABEL_MAP = {
    pending: '待处理',
    uploading: '上传中',
    queued: '排队中',
    processing: '分析中',
    completed: '已完成',
    failed: '分析失败',
    quality_insufficient: '视频质量不足',
};
function formatUploadedAt(uploadedAt) {
    const date = new Date(uploadedAt);
    if (Number.isNaN(date.getTime()))
        return uploadedAt;
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
}
function getProgress(status) {
    if (status === 'completed')
        return 100;
    if (status === 'processing')
        return 60;
    if (status === 'queued')
        return 35;
    if (status === 'uploading')
        return 15;
    if (status === 'pending')
        return 5;
    return 0;
}
function buildResultText(item) {
    if (item.status === 'completed') {
        if (typeof item.averageScore === 'number')
            return `${item.averageScore} 分`;
        return item.grade || '已完成';
    }
    if (item.status === 'quality_insufficient')
        return '质量不足';
    if (item.status === 'failed')
        return '分析失败';
    return '处理中';
}
function buildDetailText(item) {
    if (item.status === 'quality_insufficient' || item.status === 'failed') {
        return item.failReason || '建议重新上传视频后再试。';
    }
    if (item.status === 'completed') {
        if (typeof item.duration === 'number' && item.duration > 0) {
            return `训练时长 ${item.duration} 秒`;
        }
        return '分析已完成，可查看详细报告。';
    }
    return '结果生成后会自动同步到报告页。';
}
function buildActionText(status) {
    if (status === 'completed')
        return '查看报告';
    if (status === 'processing' || status === 'queued' || status === 'uploading' || status === 'pending')
        return '查看进度';
    if (status === 'quality_insufficient')
        return '按要求重传';
    return '重新上传';
}
Page({
    data: {
        loading: true,
        displayMode: 'elderly',
        totalCountText: '0 条记录',
        completedCount: 0,
        processingCount: 0,
        failedCount: 0,
        items: [],
    },
    async onShow() {
        this.setData({ displayMode: (0, session_1.getDisplayMode)(), loading: true });
        try {
            const rawItems = await (0, history_1.getHistoryVideos)();
            const items = rawItems.map((item) => {
                const status = item.status;
                return {
                    videoId: item.videoId,
                    actionType: item.actionType,
                    actionLabel: ACTION_LABEL_MAP[item.actionType] || '训练动作',
                    status,
                    statusLabel: STATUS_LABEL_MAP[status] || '处理中',
                    statusClassName: status,
                    uploadedAtLabel: formatUploadedAt(item.uploadedAt),
                    resultText: buildResultText({ status, averageScore: item.averageScore, grade: item.grade }),
                    detailText: buildDetailText({ status, failReason: item.failReason, duration: item.duration }),
                    progressPercent: getProgress(status),
                    actionText: buildActionText(status),
                };
            });
            const completedCount = rawItems.filter((item) => item.status === 'completed').length;
            const processingCount = rawItems.filter((item) => item.status === 'processing' || item.status === 'queued' || item.status === 'uploading' || item.status === 'pending').length;
            const failedCount = rawItems.filter((item) => item.status === 'failed' || item.status === 'quality_insufficient').length;
            this.setData({
                items,
                totalCountText: `${rawItems.length} 条记录`,
                completedCount,
                processingCount,
                failedCount,
            });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    onViewDetail(event) {
        const { videoId, status, actionType } = event.currentTarget.dataset;
        if (status === 'completed') {
            wx.navigateTo({ url: `/pages/report/index?videoId=${videoId}` });
            return;
        }
        if (status === 'processing' || status === 'queued' || status === 'pending' || status === 'uploading') {
            wx.navigateTo({ url: `/pages/analyzing/index?videoId=${videoId}` });
            return;
        }
        if (status === 'quality_insufficient') {
            wx.showModal({
                title: '视频质量不足',
                content: '建议先回到指导页确认拍摄角度、光线和入镜范围后，再重新上传。',
                confirmText: '去重传',
                success: (res) => {
                    if (res.confirm && actionType) {
                        wx.redirectTo({ url: `/pages/upload/index?actionType=${actionType}` });
                    }
                },
            });
            return;
        }
        if (status === 'failed' && actionType) {
            wx.redirectTo({ url: `/pages/upload/index?actionType=${actionType}` });
            return;
        }
        wx.showToast({ title: '当前记录暂无报告', icon: 'none' });
    },
});
