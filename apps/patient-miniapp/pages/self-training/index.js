'use strict';
const me = require('../../services/me');
const labels = { abdominal_crunch: '缩腹运动', pelvic_tilt: '骨盆倾斜', knee_rotation: '膝关节旋转' };
Page({
  data: { loading: true, failed: false, record: null, actionLabel: '自主练习', recordedText: '' },
  onLoad(options) { this.recordId = Number(options.id); this.loadRecord(); },
  async loadRecord() {
    this.setData({ loading: true, failed: false });
    try {
      const record = await me.getSelfTraining(this.recordId);
      const date = new Date(record.recordedAt);
      const pad = (n) => String(n).padStart(2, '0');
      const recordedText = Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
      this.setData({ record, recordedText, actionLabel: labels[record.actionType] || '自主练习' });
    } catch (_error) { this.setData({ failed: true }); }
    finally { this.setData({ loading: false }); }
  },
  onRetry() { this.loadRecord(); },
  onChooseAction() {
    const action = this.data.record?.actionType;
    if (action) wx.navigateTo({ url: `/pages/guidance/detail?actionType=${encodeURIComponent(action)}` });
    else wx.redirectTo({ url: '/pages/guidance/index' });
  },
});
