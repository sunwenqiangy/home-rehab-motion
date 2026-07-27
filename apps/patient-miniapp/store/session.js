"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getToken = getToken;
exports.setToken = setToken;
exports.isPreviewSession = isPreviewSession;
exports.startPreviewSession = startPreviewSession;
exports.clearSession = clearSession;
exports.getDisplayMode = getDisplayMode;
exports.setDisplayMode = setDisplayMode;
exports.saveRecentUploadMeta = saveRecentUploadMeta;
exports.getRecentUploadMeta = getRecentUploadMeta;
exports.savePendingUploadDraft = savePendingUploadDraft;
exports.getPendingUploadDraft = getPendingUploadDraft;
exports.clearPendingUploadDraft = clearPendingUploadDraft;
exports.consumePendingUploadDraft = consumePendingUploadDraft;
const TOKEN_KEY = 'home-rehab-motion_token';
const PREVIEW_TOKEN = 'home-rehab-motion-local-preview-session';
const DISPLAY_MODE_KEY = 'home-rehab-motion_display_mode';
const RECENT_UPLOAD_META_KEY = 'home-rehab-motion_recent_upload_meta';
const PENDING_UPLOAD_DRAFT_KEY = 'home-rehab-motion_pending_upload_draft';
function getToken() {
    return wx.getStorageSync(TOKEN_KEY) || '';
}
function setToken(token) {
    wx.setStorageSync(TOKEN_KEY, token);
}
function isPreviewSession() {
    return getToken() === PREVIEW_TOKEN;
}
function startPreviewSession() {
    setToken(PREVIEW_TOKEN);
    setDisplayMode('elderly');
}
function clearSession() {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(DISPLAY_MODE_KEY);
}
function getDisplayMode() {
    return wx.getStorageSync(DISPLAY_MODE_KEY) || 'elderly';
}
function setDisplayMode(mode) {
    wx.setStorageSync(DISPLAY_MODE_KEY, mode);
}
function getRecentUploadMetaMap() {
    return wx.getStorageSync(RECENT_UPLOAD_META_KEY) || {};
}
function saveRecentUploadMeta(meta) {
    const metaMap = getRecentUploadMetaMap();
    metaMap[String(meta.videoId)] = meta;
    wx.setStorageSync(RECENT_UPLOAD_META_KEY, metaMap);
}
function getRecentUploadMeta(videoId) {
    const metaMap = getRecentUploadMetaMap();
    return metaMap[String(videoId)] || null;
}
function savePendingUploadDraft(draft) {
    wx.setStorageSync(PENDING_UPLOAD_DRAFT_KEY, draft);
}
function getPendingUploadDraft() {
    return wx.getStorageSync(PENDING_UPLOAD_DRAFT_KEY) || null;
}
function clearPendingUploadDraft() {
    wx.removeStorageSync(PENDING_UPLOAD_DRAFT_KEY);
}
function consumePendingUploadDraft() {
    const draft = getPendingUploadDraft();
    if (draft) {
        clearPendingUploadDraft();
    }
    return draft;
}
