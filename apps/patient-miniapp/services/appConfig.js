"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_APP_CONFIG = void 0;
exports.fetchAppConfig = fetchAppConfig;
const request_1 = require("../utils/request");
/** 默认配置 —— 网络请求失败时的兜底 */
exports.DEFAULT_APP_CONFIG = {
    videoMinDurationSeconds: 10,
videoMaxDurationSeconds: 300,
videoRecordMaxDurationSeconds: 120,
    videoMaxSizeMB: 200,
    weeklyTarget: 7,
    analyzingMinWaitSeconds: 20,
    supportedActionTypes: ['abdominal_crunch', 'pelvic_tilt', 'knee_rotation'],
};
function fetchAppConfig() {
    return (0, request_1.request)({
        url: '/me/app-config',
    });
}
