"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wxLogin = wxLogin;
exports.wxPhoneLogin = wxPhoneLogin;
const request_1 = require("../utils/request");
const appConfig_1 = require("./appConfig");
const session_1 = require("../store/session");
async function saveLoginSession(data) {
    (0, session_1.setToken)(data.token);
    (0, session_1.setDisplayMode)(data.displayMode);
    try {
        const app = getApp();
        app.globalData.appConfig = await (0, appConfig_1.fetchAppConfig)();
    }
    catch (_error) {
        // 配置加载失败时保留当前默认配置
    }
    return data;
}
async function wxLogin(code) {
    const data = await (0, request_1.request)({
        url: '/auth/wx-login',
        method: 'POST',
        data: { code },
    });
    return saveLoginSession(data);
}
async function wxPhoneLogin(wxCode, phoneCode) {
    const data = await (0, request_1.request)({
        url: '/auth/wx-phone-login',
        method: 'POST',
        data: { wxCode, phoneCode },
    });
    return saveLoginSession(data);
}
