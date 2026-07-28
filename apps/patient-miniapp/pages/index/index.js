"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const appConfig_1 = require("../../services/appConfig");
const history_1 = require("../../services/history");
const me_1 = require("../../services/me");
const notification_1 = require("../../services/notification");
const session_1 = require("../../store/session");
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const ACTION_ICON_MAP = {
    abdominal_crunch: '🫁',
    pelvic_tilt: '🦴',
    knee_rotation: '🦵',
};
const ACTION_CHIP_CLASS_MAP = {
    abdominal_crunch: 'v4-chip-teal',
    pelvic_tilt: 'v4-chip-green',
    knee_rotation: 'v4-chip-orange',
};
const CONTENT_ID_MAP = {
    abdominal_crunch: 1,
    pelvic_tilt: 2,
    knee_rotation: 3,
};
function getAppConfig() {
    const app = getApp();
    return app.globalData.appConfig || appConfig_1.DEFAULT_APP_CONFIG;
}
function buildQuickActions() {
    const cfg = getAppConfig();
    const supported = cfg.supportedActionTypes.length
        ? cfg.supportedActionTypes
        : ['abdominal_crunch'];
    return supported.map((actionType) => ({
        actionType,
        contentId: CONTENT_ID_MAP[actionType] || 1,
        icon: ACTION_ICON_MAP[actionType] || '🏋️',
        label: ACTION_LABEL_MAP[actionType] || '训练动作',
        chipText: '去训练',
        chipClass: ACTION_CHIP_CLASS_MAP[actionType] || 'v4-chip-teal',
    }));
}
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
    quality_insufficient: '质量不足',
};
function formatTime(dateText) {
    if (!dateText)
        return '';
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime()))
        return '';
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${hours}:${minutes}`;
}
function formatRelativeDate(dateText) {
    if (!dateText)
        return '';
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime()))
        return '';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diff = Math.round((today - target) / 86400000);
    if (diff === 0)
        return `今天 ${formatTime(dateText)}`;
    if (diff === 1)
        return `昨天 ${formatTime(dateText)}`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
}
function getActionColorClass(actionType) {
    if (actionType === 'abdominal_crunch')
        return 'green';
    if (actionType === 'pelvic_tilt')
        return 'teal';
    return 'orange';
}
function buildRecentItems(items) {
    return items.slice(0, 3).map((item) => {
        const relativeDate = formatRelativeDate(item.uploadedAt);
        const colorClass = getActionColorClass(item.actionType);
        const base = {
            videoId: item.videoId,
            actionType: item.actionType,
            status: item.status,
            title: ACTION_LABEL_MAP[item.actionType] || '训练动作',
            subText: relativeDate,
            dotClass: `v4-dot-${item.status === 'failed' || item.status === 'quality_insufficient' ? 'red' : colorClass}`,
            statusLabel: STATUS_LABEL_MAP[item.status],
            rightType: 'chip',
            rightText: '查看',
            rightClass: 'v4-chip-teal',
        };
        if (item.status === 'completed') {
            const score = typeof item.averageScore === 'number' ? Math.round(item.averageScore) : 0;
            return {
                ...base,
                rightType: 'score',
                rightText: score > 0 ? `${score}分` : '完成',
                rightClass: `v4-list-badge-${colorClass}`,
            };
        }
        if (item.status === 'processing' || item.status === 'queued' || item.status === 'pending' || item.status === 'uploading') {
            return {
                ...base,
                subText: relativeDate,
                rightType: 'chip',
                rightText: '查看',
                rightClass: 'v4-chip-teal',
            };
        }
        return {
            ...base,
            subText: `${relativeDate} · ${STATUS_LABEL_MAP[item.status]}`,
            rightType: 'chip',
            rightText: '重新上传',
            rightClass: 'v4-chip-coral',
        };
    });
}
function buildStageItems(stage) {
    const activeIndex = stage === 'incentive' ? 2 : stage === 'consolidation' ? 1 : 0;
    const stageName = activeIndex === 0 ? '熟悉动作' : activeIndex === 1 ? '稳定练习' : '坚持成长';
    const source = [
        { title: '熟悉动作（第1~2周）', tip: '跟着步骤慢慢做，先把动作做得舒服、稳定。' },
        { title: '稳定练习（第3~4周）', tip: '保持节奏稳定，保持时间再延长 1~2 秒。' },
        { title: '坚持成长（第5周+）', tip: '关注连续训练、累计训练日和徽章带来的成长。' },
    ];
    return {
        stageTitle: `🌿 当前阶段：${stageName}`,
        stageTag: '继续练会更稳',
        items: source.map((item, index) => ({
            ...item,
            stateClass: index === activeIndex ? 'v4-stage-card-active' : 'v4-stage-card-waiting',
        })),
    };
}
function buildWeekDays(weeklyCalendar) {
    if (Array.isArray(weeklyCalendar) && weeklyCalendar.length === WEEK_DAYS.length) {
        return weeklyCalendar.map((day, index) => ({
            label: WEEK_DAYS[index],
            stateClass: day.trained
                ? `v4-day-pill-done${day.isToday ? ' v4-day-pill-today' : ''}`
                : day.isToday
                    ? 'v4-day-pill-today'
                    : '',
        }));
    }
    // 接口灰度期间保留正确的“今天”定位，避免再按完成数量错点亮周一。
    const today = new Date().getDay();
    const todayIndex = today === 0 ? 6 : today - 1;
    return WEEK_DAYS.map((label, index) => ({
        label,
        stateClass: index === todayIndex ? 'v4-day-pill-today' : '',
    }));
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        isLoggedIn: false,
        greetingText: '👋 您好，欢迎体验',
        unreadCount: 0,
        showMessageReminder: false,
        heroTitle: '今天还没训练',
        heroSub: '完成 1 次训练即可达标，系统会自动分析动作并给出建议。',
        feedbackTitle: '消息提醒',
        feedbackDesc: '暂时没有新的消息。',
        feedbackActionText: '查看消息',
        quickActions: [],
        weeklyLabel: '0 / 7 天',
        weeklyDesc: '上周完成 0 / 7，本周保持每日训练，会更快看到变化。',
        weeklyProgressPercent: 0,
        weekDays: [],
        stageTitle: '🌿 当前阶段：熟悉动作',
        stageTag: '继续练会更稳',
        stageItems: buildStageItems('corrective').items,
        recentTrainings: [],
        defaultAction: {
            actionType: 'abdominal_crunch',
            contentId: 1,
            icon: '🫁',
            label: '缩腹运动',
            chipText: '去训练',
            chipClass: 'v4-chip-teal',
        },
    },
    async onLoad() {
        const quickActions = buildQuickActions();
        const cfg = getAppConfig();
        const initialWeeklyLabel = `0 / ${cfg.weeklyTarget} 天`;
        try {
            const systemInfo = wx.getSystemInfoSync();
            this.setData({
                statusBarHeight: systemInfo.statusBarHeight || 20,
                quickActions,
                defaultAction: quickActions[0] || this.data.defaultAction,
                weeklyLabel: initialWeeklyLabel,
                weekDays: buildWeekDays(),
            });
        }
        catch (_error) {
            this.setData({
                statusBarHeight: 20,
                quickActions,
                defaultAction: quickActions[0] || this.data.defaultAction,
                weeklyLabel: initialWeeklyLabel,
                weekDays: buildWeekDays(),
            });
        }
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    async onShow() {
        const isLoggedIn = Boolean((0, session_1.getToken)());
        this.setData({ isLoggedIn });
        if (!isLoggedIn) {
            this.loadGuestHomeData();
            this.updateTopPlaceholderHeight();
            return;
        }
        await Promise.all([this.loadHomeData(), this.loadNoticeAndFeedback()]);
        this.updateTopPlaceholderHeight();
    },
    loadGuestHomeData() {
        const cfg = getAppConfig();
        const quickActions = buildQuickActions();
        const stage = buildStageItems('corrective');
        this.setData({
            greetingText: '👋 您好，欢迎体验',
            unreadCount: 0,
            showMessageReminder: false,
            heroTitle: '先登录，开启专属训练',
            heroSub: '登录后可保存训练记录，获得个性化动作分析与康复建议。',
            quickActions,
            defaultAction: quickActions[0] || this.data.defaultAction,
            weeklyLabel: `0 / ${cfg.weeklyTarget} 天`,
            weeklyDesc: '登录后开始记录每日训练，持续练习会更稳。',
            weeklyProgressPercent: 0,
            weekDays: buildWeekDays(),
            stageTitle: stage.stageTitle,
            stageTag: '登录后查看',
            stageItems: stage.items,
            recentTrainings: [],
        });
    },
    goToLogin() {
        wx.navigateTo({ url: '/pages/auth/login' });
    },
    requireLogin() {
        if (this.data.isLoggedIn) {
            return true;
        }
        wx.showToast({ title: '登录后可使用此功能', icon: 'none' });
        this.goToLogin();
        return false;
    },
    async loadNoticeAndFeedback() {
        try {
            const [notice, notifications] = await Promise.all([(0, notification_1.getNotificationUnreadCount)(), (0, notification_1.getNotifications)()]);
            const unreadNotifications = notifications.filter((item) => !item.readFlag);
            const analysisCount = unreadNotifications.filter((item) => item.type === 'analysis_completed').length;
            const feedbackCount = unreadNotifications.filter((item) => item.type === 'feedback_replied').length;
            const badgeCount = unreadNotifications.filter((item) => item.type === 'badge_earned').length;
            const summary = [
                analysisCount ? `分析完成 ${analysisCount} 条` : '',
                feedbackCount ? `医护回复 ${feedbackCount} 条` : '',
                badgeCount ? `新徽章 ${badgeCount} 条` : '',
            ].filter(Boolean).join(' · ');
            this.setData({
                unreadCount: notice.unreadCount,
                showMessageReminder: notice.unreadCount > 0,
                feedbackTitle: '消息提醒',
                feedbackDesc: summary,
                feedbackActionText: `查看 ${notice.unreadCount} 条`,
            });
        }
        catch (_error) {
            this.setData({
                unreadCount: 0,
                showMessageReminder: false,
                feedbackTitle: '消息提醒',
                feedbackDesc: '',
                feedbackActionText: '查看消息',
            });
        }
    },
    async loadHomeData() {
        try {
            const [profile, historyItems, trainingSummary] = await Promise.all([(0, me_1.getProfile)(), (0, history_1.getHistoryVideos)(), (0, me_1.getTrainingSummary)()]);
            const stage = buildStageItems(trainingSummary.stage);
            const cfg = getAppConfig();
            const quickActions = buildQuickActions();
            const weeklyLabel = trainingSummary.weeklyProgress.label || `0 / ${cfg.weeklyTarget} 天`;
            const weeklyProgressPercent = trainingSummary.weeklyProgress.progressPercent || 0;
            const sortedHistory = [...historyItems].sort((a, b) => {
                const t1 = new Date(a.uploadedAt).getTime();
                const t2 = new Date(b.uploadedAt).getTime();
                return t2 - t1;
            });
            const recentTrainings = buildRecentItems(sortedHistory.map((item) => ({
                videoId: item.videoId,
                actionType: item.actionType,
                status: item.status,
                uploadedAt: item.uploadedAt,
                averageScore: item.averageScore,
            })));
            const fallbackRecentTrainings = [
                {
                    videoId: 0,
                    actionType: 'abdominal_crunch',
                    status: 'completed',
                    title: '缩腹运动',
                    subText: '今天 09:30',
                    dotClass: 'v4-dot-green',
                    rightType: 'score',
                    rightText: '82分',
                    rightClass: 'v4-list-badge-green',
                    statusLabel: '已完成',
                },
                {
                    videoId: 0,
                    actionType: 'pelvic_tilt',
                    status: 'processing',
                    title: '骨盆倾斜',
                    subText: '昨天 10:15 · 分析中',
                    dotClass: 'v4-dot-teal',
                    rightType: 'chip',
                    rightText: '查看',
                    rightClass: 'v4-chip-teal',
                    statusLabel: '分析中',
                },
                {
                    videoId: 0,
                    actionType: 'knee_rotation',
                    status: 'completed',
                    title: '膝关节旋转',
                    subText: '6月22日',
                    dotClass: 'v4-dot-orange',
                    rightType: 'score',
                    rightText: '61分',
                    rightClass: 'v4-list-badge-orange',
                    statusLabel: '已完成',
                },
            ];
            this.setData({
                greetingText: `👋 您好，${profile.nickname || '李阿姨'}`,
                heroTitle: trainingSummary.todayTrainingState === 'not_started' ? '今天还没训练' : '今天已完成训练',
                heroSub: trainingSummary.todayTrainingState === 'not_started'
                    ? (trainingSummary.encourageText || '完成 1 次训练后，系统会自动分析动作并给出建议。')
                    : (trainingSummary.encourageText || '今天的训练记录已保存，继续保持自己的节奏。'),
                quickActions,
                defaultAction: quickActions[0] || this.data.defaultAction,
                weeklyLabel,
                weeklyDesc: trainingSummary.encourageText || trainingSummary.weeklyProgress.desc || '本周持续训练，会更稳定地看到动作改进。',
                weeklyProgressPercent,
                weekDays: buildWeekDays(trainingSummary.weeklyCalendar),
                stageTitle: stage.stageTitle,
                stageTag: stage.stageTag,
                stageItems: stage.items,
                recentTrainings: recentTrainings.length ? recentTrainings : fallbackRecentTrainings,
            });
        }
        catch (_error) {
            this.setData({
                greetingText: '👋 您好，李阿姨',
                weeklyLabel: '3 / 7 天',
                weeklyDesc: '上周完成 4 / 7，本周已开始第 3 天。今天再完成 1 次训练，就能保持进步节奏。',
                weeklyProgressPercent: 43,
                weekDays: [
                    { label: '一', stateClass: 'v4-day-pill-done' },
                    { label: '二', stateClass: 'v4-day-pill-done' },
                    { label: '三', stateClass: 'v4-day-pill-today' },
                    { label: '四', stateClass: '' },
                    { label: '五', stateClass: '' },
                    { label: '六', stateClass: '' },
                    { label: '日', stateClass: '' },
                ],
                stageTitle: '🌿 当前阶段：稳定练习',
                stageTag: '继续练会更稳',
                stageItems: [
                    { title: '熟悉动作（第1~2周）', tip: '跟着步骤慢慢做，先把动作做得舒服、稳定。', stateClass: 'v4-stage-card-waiting' },
                    { title: '稳定练习（第3~4周）', tip: '保持节奏稳定，保持时间再延长 1~2 秒。', stateClass: 'v4-stage-card-active' },
                    { title: '坚持成长（第5周+）', tip: '关注连续训练、累计训练日和徽章带来的成长。', stateClass: 'v4-stage-card-waiting' },
                ],
                recentTrainings: [
                    {
                        videoId: 0,
                        actionType: 'abdominal_crunch',
                        status: 'completed',
                        title: '缩腹运动',
                        subText: '今天 09:30',
                        dotClass: 'v4-dot-green',
                        rightType: 'score',
                        rightText: '82分',
                        rightClass: 'v4-list-badge-green',
                        statusLabel: '已完成',
                    },
                    {
                        videoId: 0,
                        actionType: 'pelvic_tilt',
                        status: 'processing',
                        title: '骨盆倾斜',
                        subText: '昨天 10:15 · 分析中',
                        dotClass: 'v4-dot-teal',
                        rightType: 'chip',
                        rightText: '查看',
                        rightClass: 'v4-chip-teal',
                        statusLabel: '分析中',
                    },
                    {
                        videoId: 0,
                        actionType: 'knee_rotation',
                        status: 'completed',
                        title: '膝关节旋转',
                        subText: '6月22日',
                        dotClass: 'v4-dot-orange',
                        rightType: 'score',
                        rightText: '61分',
                        rightClass: 'v4-list-badge-orange',
                        statusLabel: '已完成',
                    },
                ],
            });
        }
    },
    updateTopPlaceholderHeight() {
        wx.nextTick(() => {
            const query = wx.createSelectorQuery();
            query
                .select('.home-v4-top-sticky')
                .boundingClientRect((rect) => {
                if (rect?.height) {
                    this.setData({ topPlaceholderHeight: Math.ceil(rect.height) });
                }
            })
                .exec();
        });
    },
    onStartToday() {
        if (!this.requireLogin()) {
            return;
        }
        wx.redirectTo({ url: '/pages/guidance/index' });
    },
    onOpenNotifications() {
        if (!this.requireLogin()) {
            return;
        }
        wx.navigateTo({ url: '/pages/notifications/index' });
    },
    onOpenFeedback() {
        if (!this.requireLogin()) {
            return;
        }
        wx.navigateTo({ url: '/pages/notifications/index' });
    },
    onOpenAction(event) {
        if (!this.requireLogin()) {
            return;
        }
        const { contentId } = event.currentTarget.dataset;
        wx.navigateTo({ url: `/pages/guidance/detail?contentId=${contentId}` });
    },
    onOpenRecent(event) {
        if (!this.requireLogin()) {
            return;
        }
        const { videoId, status, actionType } = event.currentTarget.dataset;
        if (!videoId || Number(videoId) <= 0) {
            wx.showToast({ title: '示例记录，请等待真实训练数据', icon: 'none' });
            return;
        }
        if (status === 'completed') {
            wx.navigateTo({ url: `/pages/report/index?videoId=${videoId}` });
            return;
        }
        if (status === 'processing' || status === 'queued' || status === 'pending' || status === 'uploading') {
            wx.navigateTo({ url: `/pages/analyzing/index?videoId=${videoId}` });
            return;
        }
        wx.redirectTo({ url: `/pages/upload/index?actionType=${actionType}` });
    },
});
