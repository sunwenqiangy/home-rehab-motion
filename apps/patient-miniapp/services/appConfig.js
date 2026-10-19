"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_APP_CONFIG = void 0;
exports.fetchAppConfig = fetchAppConfig;
exports.getVideoLimits = getVideoLimits;
exports.formatVideoDuration = formatVideoDuration;
const request_1 = require("../utils/request");
// 仅约束本段视频；服务端旧配置可能仍返回整套训练的 120/300 秒上限。
const ACTION_MAX_SECONDS = { abdominal_crunch: 30, pelvic_tilt: 30, knee_rotation: 60 };
/** 默认配置 —— 网络请求失败时的兜底 */
exports.DEFAULT_APP_CONFIG = {
    selfTrainingEnabled: false,
    videoMinDurationSeconds: 8,
    videoMaxDurationSeconds: 60,
    videoRecordMaxDurationSeconds: 60,
    videoMaxSizeMB: 200,
    weeklyTarget: 7,
    supportedActionTypes: ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'],
};
function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}
function getVideoLimits(actionType, config = exports.DEFAULT_APP_CONFIG) {
    const actionMax = ACTION_MAX_SECONDS[actionType] || 30;
    const maxDuration = Math.min(actionMax, positiveNumber(config.videoMaxDurationSeconds, actionMax));
    const recordMaxDuration = Math.min(maxDuration, positiveNumber(config.videoRecordMaxDurationSeconds, maxDuration), 60);
    return {
        minDuration: Math.max(actionType === 'knee_rotation' ? 10 : 8, Math.min(maxDuration, positiveNumber(config.videoMinDurationSeconds, exports.DEFAULT_APP_CONFIG.videoMinDurationSeconds))),
        maxDuration,
        recordMaxDuration,
        maxSizeMB: Math.min(200, positiveNumber(config.videoMaxSizeMB, exports.DEFAULT_APP_CONFIG.videoMaxSizeMB)),
    };
}
function formatVideoDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '未选择';
    const wholeSeconds = Math.round(seconds);
    if (wholeSeconds < 60) return `${wholeSeconds} 秒`;
    const minutes = Math.floor(wholeSeconds / 60);
    return wholeSeconds % 60 ? `${minutes} 分 ${wholeSeconds % 60} 秒` : `${minutes} 分钟`;
}
function fetchAppConfig() {
    return (0, request_1.request)({ url: '/me/app-config' }).then((config) => ({
        ...exports.DEFAULT_APP_CONFIG,
        ...(config && typeof config === 'object' ? config : {}),
        supportedActionTypes: Array.isArray(config?.supportedActionTypes) && config.supportedActionTypes.length
            ? config.supportedActionTypes
            : exports.DEFAULT_APP_CONFIG.supportedActionTypes,
    }));
}
