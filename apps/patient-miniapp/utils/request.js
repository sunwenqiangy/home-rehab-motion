"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNetworkDiagnostics = exports.request = request;
const env_1 = require("../config/env");
const session_1 = require("../store/session");
function extractBackendMessage(payload) {
    if (!payload) {
        return '';
    }
    if (typeof payload.message === 'string') {
        return payload.message;
    }
    if (payload.message && typeof payload.message === 'object') {
        if (typeof payload.message.message === 'string') {
            return payload.message.message;
        }
        return JSON.stringify(payload.message);
    }
    return payload.error || '';
}
function createRequestError(statusCode, payload) {
    const code = typeof payload?.code === 'string' ? payload.code : `HTTP_${statusCode || 0}`;
    const message = extractBackendMessage(payload) || '服务暂时不可用，请稍后重试。';
    const error = new Error(`${code}: ${message}`);
    error.code = code;
    error.statusCode = statusCode;
    error.userMessage = message;
    return error;
}
let lastNetworkError = null;
function getNetworkDiagnostics() {
    return {
        ...(0, env_1.getRuntimeDiagnostics)(),
        lastNetworkError,
    };
}
exports.getNetworkDiagnostics = getNetworkDiagnostics;
function doRequest({ url, method = 'GET', data }, allowRelogin) {
    return new Promise((resolve, reject) => {
        const actualMethod = method === 'PATCH' ? 'POST' : method;
        const requestUrl = `${env_1.API_BASE_URL}${url}`;
        wx.request({
            url: requestUrl,
            method: actualMethod,
            data,
            timeout: env_1.REQUEST_TIMEOUT,
            header: {
                Authorization: (0, session_1.getToken)() ? `Bearer ${(0, session_1.getToken)()}` : '',
                'X-HTTP-Method-Override': method === 'PATCH' ? 'PATCH' : '',
            },
            success: (response) => {
                lastNetworkError = null;
                const payload = response.data;
                if (payload?.success) {
                    resolve(payload.data);
                    return;
                }
                if (response.statusCode === 401
                    && allowRelogin
                    && !(0, session_1.isPreviewSession)()
                    && !url.startsWith('/auth/wx-phone-login')
                    && !url.startsWith('/admin/auth/login')) {
                    (0, session_1.clearSession)();
                    wx.reLaunch({ url: '/pages/auth/login' });
                    reject(new Error('登录状态已失效，请重新登录'));
                    return;
                }
                reject(createRequestError(response.statusCode, payload));
            },
            fail: (error) => {
                const errMsg = error?.errMsg || 'Network request failed';
                lastNetworkError = {
                    url: requestUrl,
                    method: actualMethod,
                    error: errMsg,
                    at: new Date().toISOString(),
                };
                console.error('[网络请求失败]', lastNetworkError);
                reject(new Error(errMsg));
            },
        });
    });
}
function request({ url, method = 'GET', data }) {
    return doRequest({ url, method, data }, true);
}
