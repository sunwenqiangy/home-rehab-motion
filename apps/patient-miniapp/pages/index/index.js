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
    // 首页固定展示当前已运营的三类动作；接口配置仍用于训练规则、周目标等动态数据，
    // 避免后台误配置额外动作导致患者看到没有完整指导与分析能力的入口。
    const supported = ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'];
    return supported.map((actionType) => ({
        actionType,
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
function getNetworkType() {
    return new Promise((resolve) => {
        wx.getNetworkType({
            success: (result) => resolve(result.networkType || 'unknown'),
            fail: () => resolve('unknown'),
        });
    });
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
        homeLoading: false,
        homeLoadFailed: false,
        homeErrorIcon: '⚠️',
        homeErrorTitle: '',
        homeErrorDesc: '',
        greetingText: '👋 您好',
        unreadCount: 0,
        showMessageReminder: false,
        heroTitle: '今天还没训练',
        heroSub: '完成 1 次训练即可达标，系统会自动分析动作并给出建议。',
        feedbackTitle: '消息提醒',
        feedbackDesc: '暂时没有新的消息。',
        feedbackActionText: '查看消息',
        quickActions: [],
        weeklyLabel: '0 / 7 天',
        weeklyDesc: '',
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
            homeLoading: false,
            homeLoadFailed: false,
            homeErrorTitle: '',
            homeErrorDesc: '',
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
        this.setData({
            homeLoading: true,
            homeLoadFailed: false,
            homeErrorTitle: '',
            homeErrorDesc: '',
            recentTrainings: [],
        });
        const cfg = getAppConfig();
        const quickActions = buildQuickActions();
        try {
            // 三个接口彼此独立：任一非核心请求失败都不应让首页整体空白。
            const [profileResult, historyResult, summaryResult] = await Promise.allSettled([
                (0, me_1.getProfile)(),
                (0, history_1.getHistoryVideos)(),
                (0, me_1.getTrainingSummary)(),
            ]);
            const profile = profileResult.status === 'fulfilled' ? profileResult.value : null;
            const historyItems = historyResult.status === 'fulfilled' ? historyResult.value : [];
            const trainingSummary = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
            if (!profile && !trainingSummary && historyResult.status !== 'fulfilled') {
                throw new Error('首页数据加载失败');
            }
            const stage = buildStageItems(trainingSummary?.stage || 'corrective');
            const weeklyProgress = trainingSummary?.weeklyProgress;
            const sortedHistory = [...historyItems].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
            const recentTrainings = buildRecentItems(sortedHistory.map((item) => ({
                videoId: item.videoId,
                actionType: item.actionType,
                status: item.status,
                uploadedAt: item.uploadedAt,
                averageScore: item.averageScore,
            })));
            this.setData({
                homeLoadFailed: false,
                greetingText: profile?.nickname ? `👋 您好，${profile.nickname}` : '👋 您好',
                heroTitle: trainingSummary?.todayTrainingState === 'not_started' ? '今天还没训练' : trainingSummary ? '今天已完成训练' : '开始今天的训练',
                heroSub: trainingSummary?.encourageText || (trainingSummary?.todayTrainingState === 'not_started'
                    ? '完成 1 次训练后，系统会自动分析动作并给出建议。'
                    : '选择训练动作，按自己的节奏开始练习。'),
                quickActions,
                defaultAction: quickActions[0] || this.data.defaultAction,
                weeklyLabel: weeklyProgress?.label || `0 / ${cfg.weeklyTarget} 天`,
                weeklyDesc: trainingSummary?.encourageText || weeklyProgress?.desc || '完成训练后，这里会更新本周成长进度。',
                weeklyProgressPercent: weeklyProgress?.progressPercent || 0,
                weekDays: buildWeekDays(trainingSummary?.weeklyCalendar),
                stageTitle: stage.stageTitle,
                stageTag: trainingSummary ? stage.stageTag : '完成训练后更新',
                stageItems: stage.items,
                recentTrainings,
            });
        }
        catch (error) {
            console.error('[首页数据加载失败]', error);
            const networkType = await getNetworkType();
            const isOffline = networkType === 'none';
            this.setData({
                homeLoadFailed: true,
                homeErrorIcon: isOffline ? '📡' : '⚠️',
                homeErrorTitle: isOffline ? '网络连接不可用' : '服务暂时不可用',
                homeErrorDesc: isOffline
                    ? '请检查网络连接后重新加载。'
                    : '服务可能正在繁忙或维护中，请稍后重新加载。',
                greetingText: '👋 您好',
                quickActions,
                defaultAction: quickActions[0] || this.data.defaultAction,
                recentTrainings: [],
            });
        }
        finally {
            this.setData({ homeLoading: false });
            this.updateTopPlaceholderHeight();
        }
    },
    onRetryHomeLoad() {
        this.loadHomeData();
        this.loadNoticeAndFeedback();
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
        const { actionType } = event.currentTarget.dataset;
        wx.navigateTo({ url: `/pages/guidance/detail?actionType=${encodeURIComponent(actionType)}` });
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
