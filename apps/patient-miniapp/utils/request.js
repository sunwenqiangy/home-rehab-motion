"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.request = request;
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
function doRequest({ url, method = 'GET', data }, allowRelogin) {
    return new Promise((resolve, reject) => {
        const actualMethod = method === 'PATCH' ? 'POST' : method;
        wx.request({
            url: `${env_1.API_BASE_URL}${url}`,
            method: actualMethod,
            data,
            timeout: env_1.REQUEST_TIMEOUT,
            header: {
                Authorization: (0, session_1.getToken)() ? `Bearer ${(0, session_1.getToken)()}` : '',
                'X-HTTP-Method-Override': method === 'PATCH' ? 'PATCH' : '',
            },
            success: (response) => {
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
                const backendMessage = extractBackendMessage(payload);
                const details = [
                    response.statusCode ? `HTTP ${response.statusCode}` : '',
                    backendMessage,
                ].filter(Boolean).join(' - ');
                reject(new Error(details || 'Request failed'));
            },
            fail: (error) => {
                const errMsg = error?.errMsg || 'Network request failed';
                reject(new Error(errMsg));
            },
        });
    });
}
function request({ url, method = 'GET', data }) {
    return doRequest({ url, method, data }, true);
}
