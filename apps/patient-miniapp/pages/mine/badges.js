"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const me_1 = require("../../services/me");
function resolveBadgeEmoji(item) {
    const key = `${item.badgeCode} ${item.title}`;
    if (key.includes('初次'))
        return '🏁';
    if (key.includes('3'))
        return '🔥';
    if (key.includes('7'))
        return '💪';
    if (key.includes('30'))
        return '🏅';
    if (key.includes('优秀'))
        return '⭐';
    if (key.includes('稳定'))
        return '🌟';
    return '🏅';
}
function resolveBubbleColor(item) {
    const key = `${item.badgeCode} ${item.title}`;
    if (key.includes('初次'))
        return 'teal';
    if (key.includes('3'))
        return 'orange';
    if (key.includes('7'))
        return 'green';
    if (key.includes('30'))
        return 'teal';
    if (key.includes('优秀'))
        return 'orange';
    if (key.includes('稳定'))
        return 'green';
    return 'teal';
}
function formatAwardedAt(awardedAt) {
    if (!awardedAt)
        return '未解锁';
    const date = new Date(awardedAt);
    if (Number.isNaN(date.getTime()))
        return '已解锁';
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${month}-${day}`;
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        loading: true,
        loadFailed: false,
        progressText: '--',
        progressPercent: 0,
        unlockedCount: 0,
        lockedCount: 0,
        filterMode: 'all',
        unlockedItems: [],
        lockedItems: [],
        highlightBadgeCode: '',
    },
    onLoad(options) {
        const sysInfo = wx.getSystemInfoSync();
        this.setData({
            statusBarHeight: sysInfo.statusBarHeight || 20,
            highlightBadgeCode: decodeURIComponent((options || {}).highlight || ''),
        });
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    async onShow() {
        this.setData({ loading: true, loadFailed: false, unlockedItems: [], lockedItems: [], progressText: '--', progressPercent: 0 });
        try {
            const badgeWall = await (0, me_1.getBadgeWall)();
            const allItems = badgeWall.items.map((item) => ({
                badgeCode: item.badgeCode,
                title: item.title,
                description: item.progress?.message || item.description || '持续训练可解锁该徽章。',
                unlocked: item.unlocked,
                dateText: formatAwardedAt(item.awardedAt),
                emoji: resolveBadgeEmoji({ badgeCode: item.badgeCode, title: item.title }),
                bubbleColor: resolveBubbleColor({ badgeCode: item.badgeCode, title: item.title }),
                highlighted: item.badgeCode === this.data.highlightBadgeCode,
            }));
            const unlockedItems = allItems.filter((item) => item.unlocked);
            const lockedItems = allItems.filter((item) => !item.unlocked);
            const totalCount = badgeWall.totalCount || allItems.length;
            const unlockedCount = badgeWall.unlockedCount || unlockedItems.length;
            const progressPercent = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
            this.setData({
                unlockedItems,
                lockedItems,
                unlockedCount,
                lockedCount: Math.max(0, totalCount - unlockedCount),
                progressText: `${unlockedCount} / ${totalCount} 已获得`,
                progressPercent,
            });
        }
        catch (error) {
            console.error('[徽章数据加载失败]', error);
            this.setData({ loadFailed: true, unlockedItems: [], lockedItems: [], progressText: '--', progressPercent: 0 });
        }
        finally {
            this.setData({ loading: false });
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
    onGoBack() {
        wx.navigateBack({ delta: 1 });
    },
    onRetryLoad() {
        this.onShow();
    },
    onFilterAll() {
        this.setData({ filterMode: 'all' });
    },
    onFilterUnlocked() {
        this.setData({ filterMode: 'unlocked' });
    },
    onFilterLocked() {
        this.setData({ filterMode: 'locked' });
    },
});
