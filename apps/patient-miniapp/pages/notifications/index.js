"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const notification_1 = require("../../services/notification");
function formatNotificationTime(createdAt) {
    if (!createdAt)
        return '刚刚';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()))
        return '刚刚';
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
}
function buildViewItem(item) {
    let title = '系统消息';
    let detailText = item.content;
    let actionText = '我知道了';
    let chipColor = 'gray';
    let dotColor = 'teal';
    if (item.type === 'analysis_completed') {
        title = '分析已完成';
        detailText = '您上传的训练视频已生成报告，可前往查看。';
        actionText = '查看报告';
        chipColor = 'teal';
        dotColor = 'green';
    }
    else if (item.type === 'feedback_replied') {
        title = '您的训练反馈有新回复';
        detailText = '工作人员已补充训练指导，点击查看完整沟通记录。';
        actionText = '查看回复';
        chipColor = 'orange';
        dotColor = 'orange';
    }
    else if (item.type === 'system_message') {
        title = item.title || '已收到您的训练反馈';
        detailText = item.content || '工作人员会在方便时处理，结果将通过消息中心通知您。';
        actionText = '查看工单';
        chipColor = 'teal';
        dotColor = 'teal';
    }
    else if (item.type === 'badge_earned') {
        title = '您获得了新徽章';
        detailText = '连续7天训练成就已同步到"我的"页。';
        actionText = '去查看';
        chipColor = 'gray';
        dotColor = 'gray';
    }
    return {
        notificationId: item.notificationId,
        type: item.type,
        relatedId: item.relatedId || '',
        readFlag: item.readFlag,
        title,
        detailText,
        actionText,
        chipColor,
        dotColor,
        timeText: formatNotificationTime(item.createdAt),
        unreadCount: item.readFlag ? 0 : 1,
    };
}
Page({
    data: {
        statusBarHeight: 20,
        topPlaceholderHeight: 128,
        loading: true,
        loadFailed: false,
        items: [],
        filteredItems: [],
        typeChips: [],
        activeFilter: 'all',
    },
    onLoad() {
        const sysInfo = wx.getSystemInfoSync();
        this.setData({ statusBarHeight: sysInfo.statusBarHeight || 20 });
    },
    onReady() {
        this.updateTopPlaceholderHeight();
    },
    async onShow() {
        this.setData({ loading: true, loadFailed: false, items: [], filteredItems: [], typeChips: [] });
        try {
            const [items, _unread] = await Promise.all([(0, notification_1.getNotifications)(), (0, notification_1.getNotificationUnreadCount)()]);
            const viewItems = items.map(buildViewItem);
            // Build type chips based on data
            const analysisCount = viewItems.filter((i) => i.type === 'analysis_completed' && !i.readFlag).length;
            const feedbackCount = viewItems.filter((i) => i.type === 'feedback_replied' && !i.readFlag).length;
            const badgeCount = viewItems.filter((i) => i.type === 'badge_earned' && !i.readFlag).length;
            const activeFilter = this.data.activeFilter;
            const unreadCount = viewItems.filter((item) => !item.readFlag).length;
            const typeChips = [
                { key: 'all', label: `全部 ${unreadCount || ''}`.trim(), color: 'gray', active: activeFilter === 'all' },
                { key: 'analysis', label: `分析完成 ${analysisCount || ''}`.trim(), color: 'teal', active: activeFilter === 'analysis' },
                { key: 'feedback', label: `反馈回复 ${feedbackCount || ''}`.trim(), color: 'orange', active: activeFilter === 'feedback' },
                { key: 'badge', label: `徽章 ${badgeCount || ''}`.trim(), color: 'gray', active: activeFilter === 'badge' },
            ];
            this.setData({
                items: viewItems,
                filteredItems: this.filterItems(viewItems, activeFilter),
                typeChips,
            });
        }
        catch (error) {
            console.error('[消息中心加载失败]', error);
            this.setData({ loadFailed: true, items: [], filteredItems: [], typeChips: [] });
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
    filterItems(items, filter) {
        if (filter === 'all')
            return items;
        const typeMap = {
            analysis: 'analysis_completed',
            feedback: 'feedback_replied',
            badge: 'badge_earned',
        };
        return items.filter((item) => item.type === typeMap[filter]);
    },
    onFilterNotifications(event) {
        const filter = event.currentTarget.dataset.filter;
        const activeFilter = filter === 'all' || this.data.activeFilter === filter ? 'all' : filter;
        const typeChips = this.data.typeChips.map((chip) => ({ ...chip, active: chip.key === activeFilter }));
        this.setData({
            activeFilter,
            typeChips,
            filteredItems: this.filterItems(this.data.items, activeFilter),
        });
    },
    async onOpenNotification(event) {
        const dataset = event.currentTarget.dataset;
        const notificationId = Number(dataset.notificationId);
        const readFlag = Boolean(dataset.readFlag);
        const type = dataset.type;
        const relatedId = dataset.relatedId || '';
        if (!readFlag) {
            try {
                await (0, notification_1.markNotificationAsRead)(notificationId);
                const items = this.data.items.map((item) => item.notificationId === notificationId ? { ...item, readFlag: true } : item);
                this.setData({
                    items,
                    filteredItems: this.filterItems(items, this.data.activeFilter),
                });
            }
            catch (_error) {
                wx.showToast({ title: '标记已读失败', icon: 'none' });
            }
        }
        if (type === 'analysis_completed') {
            const reportVideoId = Number(relatedId) || notificationId;
            if (reportVideoId > 0) {
                wx.navigateTo({ url: `/pages/report/index?videoId=${reportVideoId}` });
                return;
            }
            wx.showToast({ title: '报告编号无效，请到历史页查看', icon: 'none' });
            return;
        }
        if (type === 'feedback_replied' || type === 'system_message') {
            const feedbackId = Number(relatedId) || notificationId;
            if (feedbackId > 0) {
                wx.navigateTo({ url: `/pages/feedback/detail?feedbackId=${feedbackId}&returnTo=notification` });
                return;
            }
            wx.showToast({ title: '反馈编号无效，请稍后重试', icon: 'none' });
            return;
        }
        if (type === 'badge_earned') {
            const badgeCode = encodeURIComponent(String(relatedId || ''));
            wx.navigateTo({ url: `/pages/mine/badges?highlight=${badgeCode}` });
            return;
        }
        wx.showToast({ title: '已查看通知', icon: 'none' });
    },
});
