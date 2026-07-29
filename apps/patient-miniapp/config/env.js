"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRuntimeDiagnostics = exports.REQUEST_TIMEOUT = exports.API_BASE_URL = void 0;
const LOCAL_API_BASE_URL = 'http://127.0.0.1:3000/api';
const PRODUCTION_API_BASE_URL = 'https://sunwenqiang.cn/api';
function getRuntimeInfo() {
    try {
        const envVersion = wx.getAccountInfoSync?.().miniProgram?.envVersion || 'unknown';
        // 仅微信开发者工具本地运行时为 devtools；真机调试即使是开发版，也不会走本机地址。
        const platform = wx.getSystemInfoSync?.().platform || 'unknown';
        return { envVersion, platform };
    }
    catch (_error) {
        return { envVersion: 'unknown', platform: 'unknown' };
    }
}
function resolveApiBaseUrl() {
    const { platform } = getRuntimeInfo();
    return platform === 'devtools' ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL;
}
function getRuntimeDiagnostics() {
    const runtime = getRuntimeInfo();
    return {
        ...runtime,
        apiBaseUrl: exports.API_BASE_URL,
    };
}
exports.getRuntimeDiagnostics = getRuntimeDiagnostics;
exports.API_BASE_URL = resolveApiBaseUrl();
exports.REQUEST_TIMEOUT = 10000;
