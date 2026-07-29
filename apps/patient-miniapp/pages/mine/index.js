"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const me_1 = require("../../services/me");
const notification_1 = require("../../services/notification");
const session_1 = require("../../store/session");
function resolveBadgeEmoji(title) {
    if (title.includes('初次'))
        return '🏁';
    if (title.includes('3'))
        return '🔥';
    if (title.includes('7'))
        return '💪';
    return '🏅';
}
function resolveBadgeColor(title) {
    if (title.includes('初次'))
        return 'teal';
    if (title.includes('3'))
        return 'orange';
    if (title.includes('7'))
        return 'green';
    return 'teal';
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        isLoggedIn: false,
        isPreviewMode: false,
        nickname: '',
        profileLine: '女 · 62岁 · 康复第6周',
        totalCount: 42,
        totalDays: 28,
        maxScore: 89,
        badgeCountText: '已获得3个',
        badgeWallItems: [],
        unreadNotificationCount: 0,
        phoneBound: false,
    },
    onLoad() {
        const sysInfo = wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    async onShow() {
        const isLoggedIn = Boolean((0, session_1.getToken)());
        const isPreviewMode = (0, session_1.isPreviewSession)();
        this.setData({ isLoggedIn, isPreviewMode });
        if (!isLoggedIn) {
            this.setData({
                nickname: '',
                profileLine: '',
                totalCount: 0,
                totalDays: 0,
                maxScore: 0,
                badgeCountText: '登录后查看',
                badgeWallItems: [],
                unreadNotificationCount: 0,
                phoneBound: false,
            });
            this.updateTopPlaceholderHeight();
            return;
        }
        try {
            const [profile, _displaySettings, _notifications, unread, trainingSummary, _badges, badgeWall] = await Promise.all([
                (0, me_1.getProfile)(),
                (0, me_1.getDisplaySettings)(),
                (0, notification_1.getNotifications)(),
                (0, notification_1.getNotificationUnreadCount)(),
                (0, me_1.getTrainingSummary)(),
                (0, me_1.getUserBadges)(),
                (0, me_1.getBadgeWall)(),
            ]);
            const genderLabel = profile.gender === 'female' ? '女' : profile.gender === 'male' ? '男' : '';
            const ageLabel = profile.age ? `${profile.age}岁` : '';
            const rehabWeekLabel = trainingSummary.rehabilitationWeek ? `康复第${trainingSummary.rehabilitationWeek}周` : '';
            const profileLine = [genderLabel, ageLabel, rehabWeekLabel].filter(Boolean).join(' · ');
            const badgeWallItems = badgeWall.items.slice(0, 3).map((item) => ({
                badgeCode: item.badgeCode,
                title: item.title,
                description: item.description || '',
                unlocked: item.unlocked,
                emoji: resolveBadgeEmoji(item.title),
                colorVar: resolveBadgeColor(item.title),
            }));
            const totalCount = trainingSummary.totalTrainingCount || 0;
            const totalDays = trainingSummary.totalTrainingDays || 0;
            const maxScore = trainingSummary.maxScore || trainingSummary.latestBestScore || 0;
            this.setData({
                nickname: profile.nickname,
                profileLine,
                totalCount,
                totalDays,
                maxScore,
                badgeCountText: `已获得${badgeWall.unlockedCount}个`,
                badgeWallItems,
                unreadNotificationCount: unread.unreadCount,
                phoneBound: Boolean(profile.phoneBound),
            });
            this.updateTopPlaceholderHeight();
        }
        catch (_error) {
            this.setData({ nickname: this.data.nickname || '训练用户' });
            this.updateTopPlaceholderHeight();
        }
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
    goToLogin() {
        wx.navigateTo({ url: '/pages/auth/login' });
    },
    requireLogin() {
        if (this.data.isLoggedIn) {
            return true;
        }
        wx.showToast({ title: '登录后可查看个人数据', icon: 'none' });
        this.goToLogin();
        return false;
    },
    onEditProfile() {
        if (!this.requireLogin()) {
            return;
        }
        wx.navigateTo({ url: '/pages/mine/profile' });
    },
    onViewNotifications() {
        if (!this.requireLogin()) {
            return;
        }
        wx.navigateTo({ url: '/pages/notifications/index' });
    },
    onViewPrivacyPolicy() {
        wx.navigateTo({ url: '/pages/mine/privacy' });
    },
    onViewAboutSystem() {
        wx.navigateTo({ url: '/pages/mine/about' });
    },
    onViewAllBadges() {
        if (!this.requireLogin()) {
            return;
        }
        wx.navigateTo({ url: '/pages/mine/badges' });
    },
    onLogout() {
        if (!this.data.isLoggedIn) {
            return;
        }
        wx.showModal({
            title: '确认退出登录？',
            content: this.data.isPreviewMode
                ? '退出后将清除体验数据，并回到微信登录页。'
                : '退出后仍可通过微信快捷登录再次进入。',
            success: (res) => {
                if (res.confirm) {
                    (0, session_1.clearSession)();
                    wx.reLaunch({ url: '/pages/auth/login' });
                }
            },
        });
    },
    onTabHome() {
        wx.redirectTo({ url: '/pages/index/index' });
    },
    onTabGuidance() {
        wx.redirectTo({ url: '/pages/guidance/index' });
    },
    onTabHistory() {
        wx.redirectTo({ url: '/pages/history/index' });
    },
});
