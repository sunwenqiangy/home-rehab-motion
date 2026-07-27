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
function buildFallbackItems() {
  return [
    { contentId: 1, actionType: 'abdominal_crunch', briefInstruction: '仰卧收腹，每次保持5秒' },
    { contentId: 2, actionType: 'pelvic_tilt', briefInstruction: '缓慢倾斜骨盆，保持平稳' },
    { contentId: 3, actionType: 'knee_rotation', briefInstruction: '缓慢旋转，控制幅度' },
  ].map(toViewItem);
}
Page({
  data: { statusBarHeight: 20, topPlaceholderHeight: 128, loading: true, activeFilter: 'all', filters: FILTERS, items: [] },
  onLoad() { try { const systemInfo = wx.getSystemInfoSync(); this.setData({ statusBarHeight: systemInfo.statusBarHeight || 20 }); } catch (_) { this.setData({ statusBarHeight: 20 }); } },
  onReady() { this.updateTopPlaceholderHeight(); },
  async onShow() {
    this.setData({ loading: true });
    try { const items = await (0, guidance_1.getGuidanceList)(); this.setData({ items: items.length ? items.map(toViewItem) : buildFallbackItems() }); }
    catch (_) { this.setData({ items: buildFallbackItems() }); }
    finally { this.setData({ loading: false }); this.updateTopPlaceholderHeight(); }
  },
  updateTopPlaceholderHeight() { wx.nextTick(() => wx.createSelectorQuery().select('.guidance-v4-top-sticky').boundingClientRect((rect) => { if (rect?.height) this.setData({ topPlaceholderHeight: Math.ceil(rect.height) }); }).exec()); },
  onFilterTap(event) { const { value } = event.currentTarget.dataset; this.setData({ activeFilter: value || 'all' }); },
  onViewDetail(event) { const { contentId } = event.currentTarget.dataset; wx.navigateTo({ url: `/pages/guidance/detail?contentId=${contentId}` }); },
});
