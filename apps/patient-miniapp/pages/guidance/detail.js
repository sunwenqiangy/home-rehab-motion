"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const appConfig_1 = require("../../services/appConfig");
const env_1 = require("../../config/env");
const guidance_1 = require("../../services/guidance");
const session_1 = require("../../store/session");
const DEFAULT_COVERS = { abdominal_crunch: '/guidance-defaults/cover-abdominal-crunch.png', pelvic_tilt: '/guidance-defaults/cover-pelvic-tilt.png', knee_rotation: '/guidance-defaults/cover-knee-rotation.png' };
const SHOOTING_DEFAULTS = {
  angle: { order: 1, typeLabel: '拍摄角度', title: '正侧面拍摄', description: '手机放在身体正侧方，镜头与身体保持垂直。', altText: '训练者平卧时，手机放在身体正侧方。', correctUrl: '../../assets/guidance/shooting-angle-side-v2.png' },
  framing: { order: 2, typeLabel: '入镜范围', title: '全身完整入镜', description: '从头到脚完整入镜，四周留出适当空间。', altText: '训练者从头到脚完整出现在手机画面内。', correctUrl: '../../assets/guidance/shooting-framing-full-body-v2.png' },
  lighting: { order: 3, typeLabel: '光线', title: '光线均匀', description: '光线均匀，避免背光和阴影。', altText: '训练者处于光线均匀的环境，身体轮廓清晰。', correctUrl: '../../assets/guidance/shooting-lighting-bright-v2.png' },
};
const SHOOTING_TYPE_LABELS = { angle: '拍摄角度', framing: '入镜范围', lighting: '光线', stability: '画面稳定' };
function getAppConfig() { const app = getApp(); return app.globalData.appConfig || appConfig_1.DEFAULT_APP_CONFIG; }
function resolveAssetUrl(url) { if (!url || /^https?:\/\//.test(url) || url.startsWith('data:')) return url || ''; const origin = env_1.API_BASE_URL.replace(/\/api\/?$/, ''); return `${origin}${url.startsWith('/') ? url : `/${url}`}`; }
function chooseTrainingVideo(source, actionType) {
  const limits = (0, appConfig_1.getVideoLimits)(actionType, getAppConfig());
  // wx.chooseVideo 的 maxDuration 仅支持 3~60 秒；相册视频仍需在上传确认页校验实际时长。
  const maxDuration = Math.max(3, Math.min(source === 'camera' ? limits.recordMaxDuration : limits.maxDuration, 60));
  return new Promise((resolve, reject) => {
    const success = (res) => {
      if (!res?.tempFilePath) return reject(new Error('NO_VIDEO_SELECTED'));
      resolve({ tempFilePath: res.tempFilePath, duration: Number(res.duration || 0), size: Number(res.size || 0) });
    };
    // 使用 chooseVideo 的 compressed=false，避免微信压缩改变姿态估计所依赖的图像细节。
    wx.chooseVideo({ sourceType: [source], maxDuration, camera: 'back', compressed: false, success, fail: reject });
  });
}
function toShootingViewModel(requirements) {
  const configured = Array.isArray(requirements) && requirements.length ? requirements : Object.keys(SHOOTING_DEFAULTS).map((type) => SHOOTING_DEFAULTS[type]);
  return configured.map((item, index) => {
    const fallback = SHOOTING_DEFAULTS[item.type] || { order: index + 1, typeLabel: SHOOTING_TYPE_LABELS[item.type] || '拍摄要求', title: '', description: '', altText: '', correctUrl: '' };
    return {
      ...fallback,
      ...item,
      order: index + 1,
      typeLabel: SHOOTING_TYPE_LABELS[item.type] || fallback.typeLabel,
      title: item.title || fallback.title,
      description: item.description || fallback.description,
      altText: item.altText || fallback.altText,
      correctUrl: resolveAssetUrl(item.correctImage?.url) || fallback.correctUrl,
    };
  });
}
function toViewModel(detail) {
  const limits = (0, appConfig_1.getVideoLimits)(detail.actionType, getAppConfig());
  const uploadLimit = (0, appConfig_1.formatVideoDuration)(limits.maxDuration);
  const recordLimit = (0, appConfig_1.formatVideoDuration)(limits.recordMaxDuration);
  return {
    ...detail,
    coverUrl: resolveAssetUrl(detail.coverImage?.url) || resolveAssetUrl(DEFAULT_COVERS[detail.actionType]),
    videoUrl: resolveAssetUrl(detail.video?.asset?.url),
    videoFallbackText: detail.video?.fallbackText || '教学视频暂时无法播放，您可以先查看下面的图文步骤。',
    steps: (detail.steps || []).map((item, index) => ({ ...item, number: index + 1, imageUrl: resolveAssetUrl(item.image?.url) })),
    commonMistakes: (detail.commonMistakes || []).map((item) => ({
      ...item,
      isVideo: Boolean(item.media?.mimeType?.startsWith('video/') || /\.(mp4|mov|m4v)(\?|$)/i.test(item.media?.url || '')),
      media: { ...item.media, url: resolveAssetUrl(item.media?.url) },
    })),
    hasCommonMistakes: (detail.commonMistakes || []).length > 0,
    shootingRequirements: toShootingViewModel(detail.shootingRequirements),
    clipLimitHint: limits.recordMaxDuration === limits.maxDuration
      ? `本动作视频不超过 ${uploadLimit}。`
      : `拍摄视频不超过 ${recordLimit}；相册视频不超过 ${uploadLimit}。`,
    clipHint: detail.actionType === 'abdominal_crunch'
      ? '请拍到至少一次完整的腹部隆起与回落。'
      : '请拍到 1～2 个完整动作。',
  };
}
function getNetworkType() { return new Promise((resolve) => wx.getNetworkType({ success: (result) => resolve(result.networkType || 'unknown'), fail: () => resolve('unknown') })); }
Page({
  data: { loading: true, failed: false, errorIcon: '⚠️', errorTitle: '', errorDesc: '', videoFailed: false, statusBarHeight: 20, navBarHeight: 44, topPlaceholderHeight: 128, detail: null, contentId: 0, actionType: '', loadedVersion: 0 },
  onReady() { this.updateTopPlaceholderHeight(); },
  onShow() { if (this.data.contentId) this.loadPublishedDetail(false); },
  async onLoad(query) { try { const app = getApp(); app.globalData.appConfig = await (0, appConfig_1.fetchAppConfig)(); } catch (_) {} const sysInfo = wx.getSystemInfoSync(); const statusBarHeight = sysInfo.statusBarHeight || 20; const capsule = wx.getMenuButtonBoundingClientRect?.(); const navBarHeight = capsule ? Math.max(44, capsule.height + (capsule.top - statusBarHeight) * 2) : 44; this.setData({ statusBarHeight, navBarHeight }); const contentId = Number(query.contentId || query.id); const actionType = String(query.actionType || ''); if (!contentId && !actionType) return this.setData({ loading: false, failed: true, errorIcon: '📋', errorTitle: '未找到动作指导', errorDesc: '请返回训练列表，选择需要练习的动作。' }); this.setData({ contentId, actionType }); await this.loadPublishedDetail(true); },
  async loadPublishedDetail(showLoading) { if (showLoading) this.setData({ loading: true, failed: false, errorTitle: '', errorDesc: '', videoFailed: false }); try { const detail = this.data.actionType ? await (0, guidance_1.getGuidanceDetailByAction)(this.data.actionType) : await (0, guidance_1.getGuidanceDetail)(this.data.contentId); const viewModel = toViewModel(detail); const changed = this.data.loadedVersion && this.data.loadedVersion !== (viewModel.version || 0); this.setData({ detail: viewModel, loadedVersion: viewModel.version || 0, loading: false, failed: false, videoFailed: false }); if (changed) wx.showToast({ title: `已更新至 V${viewModel.version}`, icon: 'none' }); } catch (error) { console.error('[动作指导加载失败]', error); if (showLoading) { const isOffline = (await getNetworkType()) === 'none'; this.setData({ loading: false, failed: true, errorIcon: isOffline ? '📡' : '⚠️', errorTitle: isOffline ? '网络连接不可用' : '动作指导暂时不可用', errorDesc: isOffline ? '请检查网络连接后重新加载。' : '服务可能正在繁忙或维护中，请稍后重新加载。' }); } } finally { this.updateTopPlaceholderHeight(); } },
  updateTopPlaceholderHeight() { wx.nextTick(() => wx.createSelectorQuery().select('.detail-top-sticky').boundingClientRect((rect) => { if (rect?.height) this.setData({ topPlaceholderHeight: Math.ceil(rect.height) }); }).exec()); },
  onGoBack() { wx.navigateBack({ delta: 1 }); }, onRetryLoad() { this.loadPublishedDetail(true); }, onVideoError() { this.setData({ videoFailed: true }); }, onPreviewImage(event) { const { url, urls } = event.currentTarget.dataset; if (url) wx.previewImage({ current: url, urls: urls || [url] }); },
  async onStartUpload() { await this.selectVideoAndGoUpload('camera'); }, async onChooseFromAlbum() { await this.selectVideoAndGoUpload('album'); },
  async selectVideoAndGoUpload(source) { if (!(0, session_1.getToken)()) { wx.showToast({ title: '登录后可提交训练视频', icon: 'none' }); wx.navigateTo({ url: '/pages/auth/login' }); return; } const detail = this.data.detail; if (!detail) return; wx.showLoading({ title: source === 'camera' ? '正在打开摄像头...' : '正在打开相册...' }); try { const video = await chooseTrainingVideo(source, detail.actionType); (0, session_1.savePendingUploadDraft)({ actionType: detail.actionType, contentId: detail.contentId, tempFilePath: video.tempFilePath, duration: video.duration, size: video.size, source, updatedAt: Date.now() }); // 保留动作详情作为上传确认页的返回目的地；后续上传、分析、报告会逐页替换，不会累积中间页。
wx.navigateTo({ url: `/pages/upload/index?actionType=${detail.actionType}&contentId=${detail.contentId}&source=${source}` }); } catch (error) { const text = `${error?.errMsg || error?.message || ''}`; wx.showToast({ title: text.includes('cancel') ? (source === 'camera' ? '已取消录制' : '已取消选择') : (source === 'camera' ? '无法打开摄像头' : '无法打开相册'), icon: 'none' }); } finally { wx.hideLoading(); } },
});
