"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const me_1 = require("../../services/me");
Page({
    data: {
        statusBarHeight: 20,
        nickname: '',
        phoneBound: false,
        maskedPhone: '',
        saving: false,
    },
    onLoad() {
        const systemInfo = wx.getSystemInfoSync();
        this.setData({ statusBarHeight: systemInfo.statusBarHeight || 20 });
    },
    async onShow() {
        await this.loadProfile();
    },
    async loadProfile() {
        try {
            const profile = await (0, me_1.getProfile)();
            this.setData({
                nickname: profile.nickname || '',
                phoneBound: Boolean(profile.phoneBound),
                maskedPhone: profile.phoneBound ? '已绑定微信手机号' : '',
            });
        }
        catch (_error) {
            wx.showToast({ title: '资料加载失败，请稍后重试', icon: 'none' });
        }
    },
    onNicknameInput(event) {
        this.setData({ nickname: String(event.detail.value || '').slice(0, 50) });
    },
    onChooseWechatNickname(event) {
        const nickname = String(event.detail?.value || '').trim();
        if (nickname) {
            this.setData({ nickname });
        }
    },
    async onSaveNickname() {
        const nickname = String(this.data.nickname || '').trim();
        if (!nickname) {
            wx.showToast({ title: '请输入昵称', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const profile = await (0, me_1.updateProfile)(nickname);
            this.setData({ nickname: profile.nickname });
            wx.showToast({ title: '昵称已保存', icon: 'success' });
        }
        catch (_error) {
            wx.showToast({ title: '昵称保存失败，请稍后重试', icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
    async onGetPhoneNumber(event) {
        const code = String(event.detail?.code || '').trim();
        if (!code) {
            wx.showToast({ title: '您未同意手机号授权', icon: 'none' });
            return;
        }
        this.setData({ saving: true });
        try {
            const result = await (0, me_1.bindWechatPhone)(code);
            this.setData({ phoneBound: result.phoneBound, maskedPhone: result.maskedPhone });
            wx.showToast({ title: '手机号已绑定', icon: 'success' });
        }
        catch (_error) {
            wx.showToast({ title: '手机号授权失败，请重新点击授权', icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
    onBack() {
        wx.navigateBack({ delta: 1 });
    },
});
