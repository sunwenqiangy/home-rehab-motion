"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const TYPE_LABELS = {
  report_question: '报告疑问',
  action_issue: '动作问题',
  upload_issue: '上传问题',
  body_discomfort: '身体不适',
  other: '其他训练问题',
};

const STATUS_LABELS = {
  pending: '已收到',
  processing: '处理中',
  replied: '已回复',
  closed: '已关闭',
};

function getFeedbackService() {
  return require('../../services/feedback');
}

function getNotificationService() {
  return require('../../services/notification');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildMessages(detail) {
  const source = Array.isArray(detail.messages) ? detail.messages : [];
  const messages = source.map((item, index) => ({
    messageId: item.messageId || index + 1,
    senderRole: ['patient', 'staff', 'system'].includes(item.senderRole) ? item.senderRole : 'patient',
    senderLabel: item.senderRole === 'staff' ? '工作人员' : item.senderRole === 'system' ? '系统安全提示' : '我',
    displayText: item.content || '（未填写消息内容）',
    imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : [],
    timeText: formatTime(item.createdAt),
  }));

  if (!messages.length && detail.content) {
    messages.push({
      messageId: -1,
      senderRole: 'patient',
      senderLabel: '我',
      displayText: detail.content,
      timeText: formatTime(detail.createdAt),
    });
  }

  // replyContent 是兼容旧反馈数据的摘要字段；新版 messages 已包含每条工作人员回复。
  // 仅当消息列表没有任何工作人员消息时才回退展示，避免同一回复被渲染两次。
  const hasStaffMessage = messages.some((message) => message.senderRole === 'staff');
  if (detail.replyContent && !hasStaffMessage) {
    messages.push({
      messageId: -2,
      senderRole: 'staff',
      senderLabel: '工作人员',
      displayText: detail.replyContent,
      timeText: formatTime(detail.lastMessageAt || detail.createdAt),
    });
  }

  return messages;
}

Page({
  data: {
    statusBarHeight: 20,
    loading: false,
    loadFailed: false,
    refreshing: false,
    feedbackId: 0,
    feedbackTypeLabel: '训练反馈',
    status: 'pending',
    statusLabel: '已进入反馈工单',
    handlingMode: 'manual',
    messages: [],
    messageCount: 0,
    fallbackMessage: '正在读取本次训练反馈。',
    fallbackTimeText: '',
    videoId: 0,
    hasVideo: false,
    returnTo: '',
    followUpText: '',
    followUpImages: [],
    followUpUploading: false,
    followUpSubmitting: false,
  },

  onLoad(options) {
    let statusBarHeight = 20;
    try {
      statusBarHeight = (wx.getSystemInfoSync() || {}).statusBarHeight || 20;
    } catch (_error) {
      // 保持默认状态栏高度，首屏仍需可见。
    }

    const query = options || {};
    const feedbackId = Number(query.feedbackId || 0);
    this.setData({
      statusBarHeight,
      feedbackId,
      returnTo: query.returnTo || '',
      loading: false,
      loadFailed: false,
      statusLabel: feedbackId ? '正在读取反馈记录' : '未找到反馈工单',
    });

    if (!feedbackId) {
      this.setData({ loadFailed: true });
      return;
    }

    this.loadDetail(feedbackId);
  },

  onShow() {
    if (this.data.feedbackId) this.loadDetail(this.data.feedbackId);
  },

  onRefresh() {
    if (!this.data.feedbackId || this.data.refreshing) return;
    this.setData({ refreshing: true });
    this.loadDetail(this.data.feedbackId).finally(() => this.setData({ refreshing: false }));
  },

  loadDetail(feedbackId) {
    let feedbackService;
    try {
      feedbackService = getFeedbackService();
    } catch (_error) {
      this.setData({ loadFailed: true, statusLabel: '反馈页面加载失败' });
      return Promise.resolve().finally(() => {
        if (this.data.refreshing) this.setData({ refreshing: false });
      });
    }

    return feedbackService.getPatientFeedbackDetail(feedbackId)
      .then((detail) => {
        const safeDetail = detail || {};
        const messages = buildMessages(safeDetail);
        const status = safeDetail.status || 'pending';
        this.setData({
          loadFailed: false,
          feedbackTypeLabel: TYPE_LABELS[safeDetail.feedbackType] || '训练反馈',
          status,
          statusLabel: safeDetail.handlingMode === 'safety_auto'
            ? '安全提示已送达'
            : (STATUS_LABELS[status] || '已收到'),
          handlingMode: safeDetail.handlingMode || 'manual',
          messages,
          messageCount: messages.length,
          fallbackMessage: safeDetail.content || '已收到您的训练反馈。',
          fallbackTimeText: formatTime(safeDetail.createdAt),
          videoId: safeDetail.videoId || 0,
          hasVideo: Boolean(safeDetail.videoId),
        });
        return this.markReplyNotificationsAsRead(feedbackId, messages);
      })
      .catch(() => {
        this.setData({
          loadFailed: true,
          statusLabel: '暂时无法读取反馈详情',
        });
      })
      .finally(() => {
        if (this.data.refreshing) this.setData({ refreshing: false });
      });
  },

  markReplyNotificationsAsRead(feedbackId, messages) {
    if (!messages.some((message) => message.senderRole === 'staff')) {
      return Promise.resolve();
    }

    let notificationService;
    try {
      notificationService = getNotificationService();
    } catch (_error) {
      return Promise.resolve();
    }

    return notificationService.getNotifications()
      .then((notifications) => Promise.all(
        notifications
          .filter((item) => (
            item.type === 'feedback_replied'
            && !item.readFlag
            && Number(item.relatedId) === Number(feedbackId)
          ))
          .map((item) => notificationService.markNotificationAsRead(item.notificationId)),
      ))
      .catch(() => undefined);
  },

  onFollowUpInput(event) {
    this.setData({ followUpText: event.detail.value || '' });
  },

  async onChooseFollowUpImage() {
    if (this.data.followUpUploading || this.data.followUpImages.length >= 3) return;
    try {
      const result = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      const file = result.tempFiles && result.tempFiles[0];
      if (!file?.tempFilePath) return;
      if (Number(file.size || 0) > 5 * 1024 * 1024) {
        wx.showToast({ title: '单张图片不能超过 5MB', icon: 'none' });
        return;
      }
      this.setData({ followUpUploading: true });
      const feedbackService = getFeedbackService();
      const target = await feedbackService.getFeedbackImageUploadTarget();
      const uploaded = await feedbackService.uploadFeedbackImage(target, file.tempFilePath);
      this.setData({
        followUpImages: [...this.data.followUpImages, { objectKey: uploaded.objectKey, previewUrl: uploaded.assetUrl || file.tempFilePath }],
      });
    } catch (_error) {
      wx.showToast({ title: '图片上传失败，请重试', icon: 'none' });
    } finally {
      this.setData({ followUpUploading: false });
    }
  },

  onRemoveFollowUpImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const followUpImages = [...this.data.followUpImages];
    followUpImages.splice(index, 1);
    this.setData({ followUpImages });
  },

  onPreviewMessageImage(event) {
    const urls = event.currentTarget.dataset.urls || [];
    const current = event.currentTarget.dataset.url;
    if (Array.isArray(urls) && current) wx.previewImage({ current, urls });
  },

  onSubmitFollowUp() {
    const content = (this.data.followUpText || '').trim();
    if (content.length < 1 && !this.data.followUpImages.length) {
      wx.showToast({ title: '请填写内容或补充图片', icon: 'none' });
      return;
    }

    let feedbackService;
    try {
      feedbackService = getFeedbackService();
    } catch (_error) {
      wx.showToast({ title: '页面服务加载失败', icon: 'none' });
      return;
    }

    this.setData({ followUpSubmitting: true });
    feedbackService.appendPatientFeedbackMessage(this.data.feedbackId, {
      content,
      imageUrls: this.data.followUpImages.map((item) => item.objectKey),
    })
      .then(() => {
        this.setData({ followUpText: '', followUpImages: [] });
        wx.showToast({ title: '补充已发送', icon: 'success' });
        return this.loadDetail(this.data.feedbackId);
      })
      .catch((error) => wx.showToast({ title: (error?.userMessage || error?.message || '发送失败，请重试').replace(/^HTTP_\d+:\s*/, '').slice(0, 20), icon: 'none' }))
      .finally(() => this.setData({ followUpSubmitting: false }));
  },

  onViewReport() {
    if (!this.data.videoId) return;

    // 从同一份报告进入反馈时，优先回到已有报告页，避免“报告 → 反馈 → 报告”循环堆叠页面。
    const pages = getCurrentPages();
    const previousPage = pages[pages.length - 2];
    const previousVideoId = Number(previousPage?.options?.videoId || 0);
    if (previousPage?.route === 'pages/report/index' && previousVideoId === this.data.videoId) {
      wx.navigateBack({ delta: 1 });
      return;
    }

    // 消息中心等其他入口没有已有报告页时，才新开关联报告，保留原入口的返回路径。
    wx.navigateTo({ url: `/pages/report/index?videoId=${this.data.videoId}` });
  },

  onBackHistory() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({
      url: this.data.returnTo === 'notification' ? '/pages/notifications/index' : '/pages/history/index',
    });
  },
});
