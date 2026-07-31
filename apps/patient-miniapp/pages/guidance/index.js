"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const guidance_1 = require("../../services/guidance");
const env_1 = require("../../config/env");
const FILTERS = [
  { label: '全部', value: 'all' },
  { label: '缩腹运动', value: 'abdominal_crunch' },
  { label: '骨盆倾斜', value: 'pelvic_tilt' },
  { label: '膝关节旋转', value: 'knee_rotation' },
];
const DEFAULT_COVERS = {
  abdominal_crunch: '/guidance-defaults/cover-abdominal-crunch.png',
  pelvic_tilt: '/guidance-defaults/cover-pelvic-tilt.png',
  knee_rotation: '/guidance-defaults/cover-knee-rotation.png',
};
function resolveAssetUrl(url) {
  if (!url || /^https?:\/\//.test(url) || url.startsWith('data:')) return url || '';
  const origin = env_1.API_BASE_URL.replace(/\/api\/?$/, '');
  return `${origin}${url.startsWith('/') ? url : `/${url}`}`;
}
function resolveActionMeta(actionType) {
  if (actionType === 'pelvic_tilt') return { actionLabel: '骨盆倾斜', iconText: '🦴', coverClassName: 'guidance-v4-card__cover guidance-v4-card__cover--green', chipClassName: 'guidance-v4-chip guidance-v4-chip--green' };
  if (actionType === 'knee_rotation') return { actionLabel: '膝关节旋转', iconText: '🦵', coverClassName: 'guidance-v4-card__cover guidance-v4-card__cover--orange', chipClassName: 'guidance-v4-chip guidance-v4-chip--orange' };
  return { actionLabel: '缩腹运动', iconText: '🫁', coverClassName: 'guidance-v4-card__cover guidance-v4-card__cover--teal', chipClassName: 'guidance-v4-chip guidance-v4-chip--teal' };
}
function toViewItem(item) {
  return { ...item, ...resolveActionMeta(item.actionType), actionLabel: item.title || resolveActionMeta(item.actionType).actionLabel, coverUrl: resolveAssetUrl(item.coverImage?.url) || resolveAssetUrl(DEFAULT_COVERS[item.actionType]), durationLabel: item.estimatedMinutes ? `约 ${item.estimatedMinutes} 分钟` : '' };
}
function getNetworkType() {
  return new Promise((resolve) => {
    wx.getNetworkType({
      success: (result) => resolve(result.networkType || 'unknown'),
      fail: () => resolve('unknown'),
    });
  });
}
Page({
  data: {
    statusBarHeight: 20,
    topPlaceholderHeight: 128,
    loading: true,
    loadFailed: false,
    errorIcon: '⚠️',
    errorTitle: '',
    errorDesc: '',
    activeFilter: 'all',
    filters: FILTERS,
    items: [],
  },
  onLoad() { try { const systemInfo = wx.getSystemInfoSync(); this.setData({ statusBarHeight: systemInfo.statusBarHeight || 20 }); } catch (_) { this.setData({ statusBarHeight: 20 }); } },
  onReady() { this.updateTopPlaceholderHeight(); },
  async onShow() {
    await this.loadGuidance();
  },
  async loadGuidance() {
    this.setData({ loading: true, loadFailed: false, errorTitle: '', errorDesc: '', items: [] });
    try {
      const items = await (0, guidance_1.getGuidanceList)();
      this.setData({ items: items.map(toViewItem) });
    }
    catch (error) {
      // 指导内容来自后台配置，加载失败时不展示无法进入详情的本地示例动作。
      console.error('[训练指导加载失败]', error);
      const networkType = await getNetworkType();
      const isOffline = networkType === 'none';
      this.setData({
        loadFailed: true,
        errorIcon: isOffline ? '📡' : '⚠️',
        errorTitle: isOffline ? '网络连接不可用' : '训练指导暂时不可用',
        errorDesc: isOffline
          ? '请检查网络连接后重新加载。'
          : '服务可能正在繁忙或维护中，请稍后重新加载。',
        items: [],
      });
    }
    finally {
      this.setData({ loading: false });
      this.updateTopPlaceholderHeight();
    }
  },
  onRetryLoad() { this.loadGuidance(); },
  updateTopPlaceholderHeight() { wx.nextTick(() => wx.createSelectorQuery().select('.guidance-v4-top-sticky').boundingClientRect((rect) => { if (rect?.height) this.setData({ topPlaceholderHeight: Math.ceil(rect.height) }); }).exec()); },
  onFilterTap(event) { const { value } = event.currentTarget.dataset; this.setData({ activeFilter: value || 'all' }); },
  onViewDetail(event) { const { contentId } = event.currentTarget.dataset; wx.navigateTo({ url: `/pages/guidance/detail?contentId=${contentId}` }); },
});
