"use strict";

const FEEDBACK_TYPE_OPTIONS = [
  { label: '报告疑问', value: 'report_question' },
  { label: '动作问题', value: 'action_issue' },
  { label: '上传问题', value: 'upload_issue' },
  { label: '身体不适', value: 'body_discomfort' },
  { label: '其他', value: 'other' },
];

function getFeedbackService() {
  return require('../../services/feedback');
}

Page({
  data: {
    statusBarHeight: 20,
    videoId: 0,
    actionLabel: '本次训练',
    feedbackTypeOptions: FEEDBACK_TYPE_OPTIONS,
    selectedFeedbackTypeIndex: 0,
    feedbackTypeValue: FEEDBACK_TYPE_OPTIONS[0].value,
    isSafetyFeedback: false,
    feedbackText: '',
    feedbackImages: [],
    feedbackUploading: false,
    feedbackSubmitting: false,
  },

  onLoad(query) {
    const safeQuery = query || {};
    let statusBarHeight = 20;

    try {
      statusBarHeight = wx.getSystemInfoSync().statusBarHeight || statusBarHeight;
    } catch (_error) {
      // 保留默认高度，避免系统信息读取失败阻断页面首屏渲染。
    }

    let actionLabel = '本次训练';
    try {
      actionLabel = decodeURIComponent(safeQuery.actionLabel || actionLabel);
    } catch (_error) {
      actionLabel = safeQuery.actionLabel || actionLabel;
    }

    this.setData({
      statusBarHeight,
      videoId: Number(safeQuery.videoId || 0),
      actionLabel,
    });
  },

  onFeedbackTypeChange(event) {
    const selectedFeedbackTypeIndex = Number(event.detail.value || 0);
    const selected = FEEDBACK_TYPE_OPTIONS[selectedFeedbackTypeIndex] || FEEDBACK_TYPE_OPTIONS[0];
    this.setData({
      selectedFeedbackTypeIndex,
      feedbackTypeValue: selected.value,
      isSafetyFeedback: selected.value === 'body_discomfort',
    });
  },

  onFeedbackInput(event) {
    this.setData({ feedbackText: event.detail.value || '' });
  },

  async onChooseFeedbackImage() {
    if (this.data.feedbackUploading || this.data.feedbackImages.length >= 3) return;

    try {
      const result = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
      });
      const file = result.tempFiles && result.tempFiles[0];
      if (!file || !file.tempFilePath) return;

      this.setData({ feedbackUploading: true });
      const feedbackService = getFeedbackService();
      const target = await feedbackService.getFeedbackImageUploadTarget();
      const uploaded = await feedbackService.uploadFeedbackImage(
        target.uploadUrl,
        target.objectKey,
        file.tempFilePath,
      );
      this.setData({
        feedbackImages: [
          ...this.data.feedbackImages,
          { objectKey: uploaded.objectKey, previewUrl: uploaded.assetUrl },
        ],
      });
    } catch (_error) {
      wx.showToast({ title: '图片上传失败', icon: 'none' });
    } finally {
      this.setData({ feedbackUploading: false });
    }
  },

  onRemoveFeedbackImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const feedbackImages = [...this.data.feedbackImages];
    feedbackImages.splice(index, 1);
    this.setData({ feedbackImages });
  },

  async onSubmit() {
    if (this.data.feedbackSubmitting || this.data.feedbackText.trim().length < 1) {
      wx.showToast({ title: '请至少输入 1 个字', icon: 'none' });
      return;
    }

    if (this.data.feedbackTypeValue === 'body_discomfort') {
      const confirmed = await new Promise((resolve) => {
        wx.showModal({
          title: '请先确认安全提示',
          content: '请先暂停训练。若不适持续、加重或影响活动，请及时联系主治医生或前往医疗机构评估。本系统不能提供诊断或紧急医疗帮助。',
          // 小程序弹窗按钮文案最多 4 个字符，超过会触发 fail 回调并导致提交被中断。
          confirmText: '继续提交',
          cancelText: '返回修改',
          success: ({ confirm }) => resolve(Boolean(confirm)),
          fail: () => {
            wx.showToast({ title: '安全提示暂时无法确认，请重试', icon: 'none' });
            resolve(false);
          },
        });
      });
      if (!confirmed) return;
    }

    this.setData({ feedbackSubmitting: true });
    try {
      const feedback = await getFeedbackService().createFeedback({
        videoId: this.data.videoId || undefined,
        feedbackType: this.data.feedbackTypeValue,
        content: this.data.feedbackText.trim(),
        imageUrls: this.data.feedbackImages.map((item) => item.objectKey),
      });
      if (this.data.feedbackTypeValue === 'body_discomfort') {
        wx.showToast({ title: '已提交安全记录', icon: 'success' });
        wx.redirectTo({
          url: this.data.videoId
            ? `/pages/report/index?videoId=${this.data.videoId}&safetyNotice=1`
            : '/pages/history/index',
        });
        return;
      }
      wx.redirectTo({
        url: `/pages/feedback/detail?feedbackId=${feedback.feedbackId}&returnTo=report`,
      });
    } catch (_error) {
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
    } finally {
      this.setData({ feedbackSubmitting: false });
    }
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }

    wx.redirectTo({
      url: this.data.videoId
        ? `/pages/report/index?videoId=${this.data.videoId}`
        : '/pages/history/index',
    });
  },
});
