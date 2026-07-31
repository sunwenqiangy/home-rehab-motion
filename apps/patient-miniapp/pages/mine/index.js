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
        profileLine: '',
        profileLoading: false,
        statsItems: [
            { label: '总训练次数', value: '--', color: 'teal' },
            { label: '坚持天数', value: '--', color: 'green' },
            { label: '最高评分', value: '--', color: 'orange' },
        ],
        badgeCountText: '--',
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
                profileLoading: false,
                statsItems: [
                    { label: '总训练次数', value: '--', color: 'teal' },
                    { label: '坚持天数', value: '--', color: 'green' },
                    { label: '最高评分', value: '--', color: 'orange' },
                ],
                badgeCountText: '登录后查看',
                badgeWallItems: [],
                unreadNotificationCount: 0,
                phoneBound: false,
            });
            this.updateTopPlaceholderHeight();
            return;
        }
        this.setData({
            profileLoading: true,
            nickname: '',
            profileLine: '',
            statsItems: [
                { label: '总训练次数', value: '--', color: 'teal' },
                { label: '坚持天数', value: '--', color: 'green' },
                { label: '最高评分', value: '--', color: 'orange' },
            ],
            badgeCountText: '--',
            badgeWallItems: [],
            unreadNotificationCount: 0,
        });
        try {
            // 页面只请求实际展示的数据；次要接口单独容错，避免一个未读数接口失败导致整页资料消失。
            const [profileResult, summaryResult, unreadResult, badgeWallResult] = await Promise.allSettled([
                (0, me_1.getProfile)(),
                (0, me_1.getTrainingSummary)(),
                (0, notification_1.getNotificationUnreadCount)(),
                (0, me_1.getBadgeWall)(),
            ]);
            if (profileResult.status !== 'fulfilled' || summaryResult.status !== 'fulfilled') {
                throw new Error('个人资料或训练汇总加载失败');
            }
            const profile = profileResult.value;
            const trainingSummary = summaryResult.value;
            const unread = unreadResult.status === 'fulfilled' ? unreadResult.value : { unreadCount: 0 };
            const badgeWall = badgeWallResult.status === 'fulfilled'
                ? badgeWallResult.value
                : { unlockedCount: 0, items: [] };
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
                profileLoading: false,
                nickname: profile.nickname,
                profileLine,
                statsItems: [
                    { label: '总训练次数', value: totalCount, color: 'teal' },
                    { label: '坚持天数', value: totalDays, color: 'green' },
                    { label: '最高评分', value: maxScore, color: 'orange' },
                ],
                badgeCountText: badgeWallResult.status === 'fulfilled' ? `已获得${badgeWall.unlockedCount}个` : '暂未加载',
                badgeWallItems,
                unreadNotificationCount: unread.unreadCount,
                phoneBound: Boolean(profile.phoneBound),
            });
            this.updateTopPlaceholderHeight();
        }
        catch (_error) {
            this.setData({
                profileLoading: false,
                nickname: '资料加载失败',
                profileLine: '请下拉刷新后重试',
                statsItems: [
                    { label: '总训练次数', value: '--', color: 'teal' },
                    { label: '坚持天数', value: '--', color: 'green' },
                    { label: '最高评分', value: '--', color: 'orange' },
                ],
                badgeCountText: '暂未加载',
                badgeWallItems: [],
                unreadNotificationCount: 0,
            });
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
