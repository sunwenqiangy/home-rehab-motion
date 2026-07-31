"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const me_1 = require("../../services/me");
Page({
    data: {
        statusBarHeight: 20,
        navHeight: 112,
        nicknameInputFocus: false,
        nickname: '',
        phoneBound: false,
        maskedPhone: '',
        age: '',
        genderIndex: 2,
        genderOptions: ['男', '女', '暂不填写'],
        saving: false,
    },
    onLoad() {
        const systemInfo = wx.getSystemInfoSync();
        const statusBarHeight = systemInfo.statusBarHeight || 20;
        // 导航内容区固定为 92rpx（46px），总高度用于为页面内容让位。
        this.setData({ statusBarHeight, navHeight: statusBarHeight + 46 });
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
                age: profile.age || '',
                genderIndex: profile.gender === 'male' ? 0 : profile.gender === 'female' ? 1 : 2,
            });
        }
        catch (_error) {
            wx.showToast({ title: '资料加载失败，请稍后重试', icon: 'none' });
        }
    },
    onNicknameInput(event) {
        this.setData({ nickname: String(event.detail.value || '').slice(0, 50) });
    },
    onUseWechatNickname() {
        // chooseNickname 不是有效的 button open-type；微信昵称能力由 input type="nickname" 提供。
        // 切换 focus 能保证再次点击时重新触发输入框焦点与微信昵称选择面板。
        this.setData({ nicknameInputFocus: false });
        setTimeout(() => this.setData({ nicknameInputFocus: true }), 0);
    },
    onAgeInput(event) {
        this.setData({ age: String(event.detail.value || '').replace(/[^0-9]/g, '').slice(0, 3) });
    },
    onGenderChange(event) {
        this.setData({ genderIndex: Number(event.detail.value) });
    },
    async onSaveProfile() {
        const nickname = String(this.data.nickname || '').trim();
        const age = this.data.age === '' ? undefined : Number(this.data.age);
        if (!nickname) {
            wx.showToast({ title: '请填写昵称', icon: 'none' });
            return;
        }
        if (age !== undefined && (!Number.isInteger(age) || age < 1 || age > 120)) {
            wx.showToast({ title: '请填写正确年龄', icon: 'none' });
            return;
        }
        const genders = ['male', 'female', 'unknown'];
        this.setData({ saving: true });
        try {
            const profile = await (0, me_1.updateProfile)({
                nickname,
                age,
                gender: genders[this.data.genderIndex],
            });
            this.setData({
                nickname: profile.nickname,
                age: profile.age || '',
                genderIndex: profile.gender === 'male' ? 0 : profile.gender === 'female' ? 1 : 2,
            });
            wx.showToast({ title: '资料已保存', icon: 'success' });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '';
            console.error('[保存个人资料失败]', message);
            wx.showToast({ title: message.includes('HTTP') ? '资料保存失败，请稍后重试' : '无法保存资料，请检查网络', icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
    async onGetPhoneNumber(event) {
        const code = String(event.detail?.code || '').trim();
        if (!code) {
            const errMsg = String(event.detail?.errMsg || '');
            console.warn('[微信手机号授权未返回凭证]', errMsg);
            wx.showToast({
                title: errMsg.includes('deny') || errMsg.includes('cancel') ? '您未同意手机号授权' : '当前微信版本暂不支持手机号授权',
                icon: 'none',
            });
            return;
        }
        this.setData({ saving: true });
        try {
            const result = await (0, me_1.bindWechatPhone)(code);
            this.setData({ phoneBound: result.phoneBound, maskedPhone: result.maskedPhone });
            wx.showToast({ title: '手机号已绑定', icon: 'success' });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '';
            console.error('[微信手机号绑定失败]', message);
            wx.showToast({ title: message.includes('未配置') ? '手机号服务暂未配置' : '手机号授权失败，请重新点击授权', icon: 'none' });
        }
        finally {
            this.setData({ saving: false });
        }
    },
    onBack() {
        wx.navigateBack({ delta: 1 });
    },
});
