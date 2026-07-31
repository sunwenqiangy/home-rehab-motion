"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const history_1 = require("../../services/history");
const me_1 = require("../../services/me");
const session_1 = require("../../store/session");
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
    review_required: '待人工复核',
};
function formatTime(uploadedAt) {
    const date = new Date(uploadedAt);
    if (Number.isNaN(date.getTime()))
        return uploadedAt;
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
}
function formatDateLabel(uploadedAt) {
    const date = new Date(uploadedAt);
    if (Number.isNaN(date.getTime()))
        return uploadedAt;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdays[date.getDay()];
    return `${month}月${day}日 · 星期${weekday}`;
}
function buildDotColor(status) {
    if (status === 'completed')
        return 'green';
    if (status === 'processing' || status === 'queued' || status === 'uploading' || status === 'pending')
        return 'teal';
    if (status === 'quality_insufficient')
        return 'orange';
    if (status === 'review_required')
        return 'orange';
    return 'red';
}
function buildRecordItem(item) {
    const status = item.status;
    const dotColor = buildDotColor(status);
    const actionLabel = ACTION_LABEL_MAP[item.actionType] || '训练动作';
    const statusLabel = STATUS_LABEL_MAP[status] || '状态待确认';
    const timeLabel = `${formatTime(item.uploadedAt)} · ${statusLabel}`;
    const showScore = status === 'completed' && typeof item.averageScore === 'number';
    let scoreText = '';
    let chipColor = 'gray';
    let chipText = '';
    if (showScore) {
        scoreText = `${item.averageScore}分`;
    }
    else if (status === 'processing' || status === 'queued' || status === 'uploading' || status === 'pending') {
        chipColor = 'teal';
        chipText = '查看';
    }
    else if (status === 'failed') {
        chipColor = 'coral';
        chipText = '重新上传';
    }
    else if (status === 'quality_insufficient') {
        chipColor = 'orange';
        chipText = '重新上传';
    }
    else if (status === 'review_required') {
        chipColor = 'orange';
        chipText = '查看说明';
    }
    return {
        videoId: item.videoId,
        actionType: item.actionType,
        actionLabel,
        status,
        statusLabel,
        dotColor,
        showScore,
        scoreText,
        chipColor,
        chipText,
        timeLabel,
    };
}
function groupByDate(items, rawItems) {
    const map = new Map();
    items.forEach((record, idx) => {
        const dateLabel = formatDateLabel(rawItems[idx].uploadedAt);
        if (!map.has(dateLabel)) {
            map.set(dateLabel, []);
        }
        map.get(dateLabel).push(record);
    });
    return Array.from(map.entries()).map(([dateLabel, records]) => ({ dateLabel, records }));
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        loading: true,
        listLoadFailed: false,
        activeFilter: 'all',
        filterChips: [
            { key: 'all', label: '全部' },
            { key: 'abdominal_crunch', label: '缩腹' },
            { key: 'pelvic_tilt', label: '骨盆' },
            { key: 'knee_rotation', label: '膝关节' },
        ],
        summaryLoading: true,
        summaryItems: [
            { label: '累计训练', value: '--', color: 'teal' },
            { label: '平均得分', value: '--', color: 'green' },
            { label: '分数趋势', value: '--', color: 'orange' },
        ],
        weeklyLabel: '--',
        weeklyProgress: 0,
        weeklyProgressUnavailable: false,
        groupedItems: [],
        allRawItems: [],
        allRecords: [],
    },
    onLoad() {
        const sysInfo = wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    async onShow() {
        if (!(0, session_1.getToken)()) {
            wx.reLaunch({ url: '/pages/auth/login' });
            return;
        }
        this.setData({
            loading: true,
            listLoadFailed: false,
            summaryLoading: true,
            summaryItems: [
                { label: '累计训练', value: '--', color: 'teal' },
                { label: '平均得分', value: '--', color: 'green' },
                { label: '分数趋势', value: '--', color: 'orange' },
            ],
            weeklyLabel: '--',
            weeklyProgress: 0,
            weeklyProgressUnavailable: false,
            groupedItems: [],
            allRawItems: [],
            allRecords: [],
        });
        try {
            const [items, trainingSummary] = await Promise.all([(0, history_1.getHistoryVideos)(), (0, me_1.getTrainingSummary)()]);
            const allRecords = items.map(buildRecordItem);
            const groupedItems = groupByDate(allRecords, items);
            const scoredItems = items.filter((item) =>
                item.status === 'completed' && typeof item.averageScore === 'number' && Number.isFinite(item.averageScore),
            );
            const avgScore = scoredItems.length
                ? Math.round(scoredItems.reduce((sum, item) => sum + item.averageScore, 0) / scoredItems.length)
                : '--';
            const improvementLevel = trainingSummary.improvementLevel;
            const scoreTrend = improvementLevel === 'clear'
                ? '进步明显'
                : improvementLevel === 'slight'
                    ? '稳步提升'
                    : improvementLevel === 'stable'
                        ? '稳定中'
                        : '--';
            const weeklyProgress = trainingSummary.weeklyProgress;
            const hasWeeklyProgress = Boolean(weeklyProgress && typeof weeklyProgress.progressPercent === 'number');
            this.setData({
                summaryLoading: false,
                allRawItems: items,
                allRecords,
                groupedItems: this.filterRecords(this.data.activeFilter, allRecords, items),
                summaryItems: [
                    { label: '累计训练', value: trainingSummary.totalTrainingCount || 0, color: 'teal' },
                    { label: '平均得分', value: avgScore, color: 'green' },
                    { label: '分数趋势', value: scoreTrend, color: 'orange' },
                ],
                weeklyLabel: hasWeeklyProgress && weeklyProgress.label ? weeklyProgress.label : '--',
                weeklyProgress: hasWeeklyProgress ? weeklyProgress.progressPercent : 0,
                weeklyProgressUnavailable: !hasWeeklyProgress,
            });
        }
        catch (error) {
            console.error('[训练历史加载失败]', error);
            this.setData({
                listLoadFailed: true,
                summaryLoading: false,
                summaryItems: [
                    { label: '累计训练', value: '--', color: 'teal' },
                    { label: '平均得分', value: '--', color: 'green' },
                    { label: '分数趋势', value: '--', color: 'orange' },
                ],
                weeklyLabel: '暂时无法加载',
                weeklyProgress: 0,
                weeklyProgressUnavailable: true,
                groupedItems: [],
                allRawItems: [],
                allRecords: [],
            });
        }
        finally {
            this.setData({ loading: false });
            this.updateTopPlaceholderHeight();
        }
    },
    onRetryWeeklyProgress() {
        this.onShow();
    },
    onRetryHistoryLoad() {
        this.onShow();
    },
    updateTopPlaceholderHeight() {
        wx.nextTick(() => {
            const query = wx.createSelectorQuery();
            query
                .select('.v4-top-sticky')
                .boundingClientRect((rect) => {
                if (rect?.height) {
                    this.setData({ topPlaceholderHeight: Math.ceil(rect.height) });
                }
            })
                .exec();
        });
    },
    filterRecords(filterKey, records, rawItems) {
        if (filterKey === 'all') {
            return groupByDate(records, rawItems);
        }
        const filtered = records.filter((r) => r.actionType === filterKey);
        const filteredRaw = rawItems.filter((_, idx) => records[idx].actionType === filterKey);
        return groupByDate(filtered, filteredRaw);
    },
    onFilterTap(event) {
        const { key } = event.currentTarget.dataset;
        this.setData({ activeFilter: key });
        const groupedItems = this.filterRecords(key, this.data.allRecords, this.data.allRawItems);
        this.setData({ groupedItems });
    },
    onViewReport(event) {
        const { videoId, status, actionType } = event.currentTarget.dataset;
        if (status === 'completed' || status === 'review_required') {
            wx.navigateTo({ url: `/pages/report/index?videoId=${videoId}` });
            return;
        }
        if (status === 'queued' || status === 'processing' || status === 'pending' || status === 'uploading') {
            wx.navigateTo({ url: `/pages/analyzing/index?videoId=${videoId}` });
            return;
        }
        if (status === 'quality_insufficient' || status === 'failed') {
            wx.navigateTo({ url: `/pages/report/index?videoId=${videoId}` });
            return;
        }
        wx.showToast({ title: '当前记录暂无报告', icon: 'none' });
    },
    onTabHome() {
        wx.redirectTo({ url: '/pages/index/index' });
    },
    onTabGuidance() {
        wx.redirectTo({ url: '/pages/guidance/index' });
    },
    onTabMine() {
        wx.redirectTo({ url: '/pages/mine/index' });
    },
});
