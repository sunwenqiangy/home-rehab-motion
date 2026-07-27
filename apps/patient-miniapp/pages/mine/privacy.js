"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const me_1 = require("../../services/me");
const session_1 = require("../../store/session");
Page({
    data: {
        displayMode: 'elderly',
        updateDateText: '2026-07-26',
        consented: false,
        consentStatusText: '正在获取授权状态…',
        summaryTags: ['仅用于训练评估', '不做商业用途', '可随时撤回授权'],
        sections: [
            {
                title: '数据收集范围',
                content: '我们仅收集与康复训练相关的数据，包括您上传的视频、动作类型、训练时长和分析结果。这些信息仅用于生成训练报告和进度追踪。',
            },
            {
                title: '数据使用目的',
                content: '训练视频仅用于动作识别和评分，帮助您获取阶段化指导。不会用于人脸识别、广告推荐或与训练无关的用途。',
            },
            {
                title: '数据存储与保护',
                content: '数据传输全程加密，存储采用权限控制与审计机制。仅授权医护与系统服务可访问相关训练数据。',
            },
            {
                title: '授权与撤回',
                content: '同意后才可以上传并分析训练视频。您可以随时在本页撤回授权；撤回后将立即停止新的上传和分析，不会自动删除已保存的数据。',
            },
        ],
    },
    onShow() {
        this.setData({ displayMode: (0, session_1.getDisplayMode)() });
        this.loadConsentStatus();
    },
    async loadConsentStatus() {
        try {
            const status = await (0, me_1.getPrivacyConsent)();
            this.setData({
                consented: status.consented,
                consentStatusText: status.consented ? '已同意视频分析授权' : '尚未同意视频分析授权',
            });
        }
        catch (_error) {
            this.setData({ consentStatusText: '暂时无法获取授权状态' });
        }
    },
    async onGrantConsent() {
        try {
            await (0, me_1.grantPrivacyConsent)();
            wx.showToast({ title: '已同意授权', icon: 'success' });
            this.loadConsentStatus();
        }
        catch (error) {
            wx.showToast({ title: error.message || '操作失败', icon: 'none' });
        }
    },
    onWithdrawConsent() {
        wx.showModal({
            title: '确认撤回授权？',
            content: '撤回后不能继续上传或分析训练视频；已保存的训练数据不会自动删除。',
            confirmText: '确认撤回',
            success: async (res) => {
                if (!res.confirm)
                    return;
                try {
                    await (0, me_1.withdrawPrivacyConsent)();
                    wx.showToast({ title: '已撤回授权', icon: 'success' });
                    this.loadConsentStatus();
                }
                catch (error) {
                    wx.showToast({ title: error.message || '操作失败', icon: 'none' });
                }
            },
        });
    },
});
