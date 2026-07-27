"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_1 = require("../../services/auth");
const session_1 = require("../../store/session");
function getWxCode() {
    return new Promise((resolve, reject) => {
        wx.login({
            success: (result) => result.code ? resolve(result.code) : reject(new Error('未获取到微信登录凭证')),
            fail: (error) => reject(new Error(error?.errMsg || '微信登录调用失败')),
        });
    });
}
function getErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('未配置微信手机号授权参数')) {
        return '手机号登录暂未配置，请联系工作人员后重试。';
    }
    if (message.includes('微信手机号授权失败')) {
        return '手机号授权未完成，请重新点击授权。';
    }
    return '登录失败，请检查网络后重试。';
}
Page({
    data: {
        statusBarHeight: 20,
        loggingIn: false,
        agreed: false,
        mockLoginEnabled: true,
    },
    onLoad() {
        if ((0, session_1.getToken)()) {
            wx.reLaunch({ url: '/pages/index/index' });
            return;
        }
        const systemInfo = wx.getSystemInfoSync();
        this.setData({ statusBarHeight: systemInfo.statusBarHeight || 20 });
    },
    onAgreementChange() {
        this.setData({ agreed: !this.data.agreed });
    },
    async onDirectLogin() {
        if (!this.data.agreed) {
            wx.showToast({ title: '请先阅读并同意隐私政策', icon: 'none' });
            return;
        }
        this.setData({ loggingIn: true });
        try {
            await (0, auth_1.wxLogin)(await getWxCode());
            wx.reLaunch({ url: '/pages/index/index' });
        }
        catch (error) {
            wx.showToast({ title: getErrorMessage(error), icon: 'none' });
        }
        finally {
            this.setData({ loggingIn: false });
        }
    },
    onMockLogin() {
        if (!this.data.agreed) {
            wx.showToast({ title: '请先阅读并同意隐私政策', icon: 'none' });
            return;
        }
        (0, session_1.startPreviewSession)();
        wx.reLaunch({ url: '/pages/index/index' });
    },
    onOpenPrivacy() {
        wx.navigateTo({ url: '/pages/mine/privacy' });
    },
});
