"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const me_1 = require("../../services/me");
const session_1 = require("../../store/session");
Page({
    data: {
        displayMode: 'elderly',
        consented: false,
        consentStatusLoaded: false,
        consentStatusText: '正在获取授权状态…',
        summaryTags: ['训练数据', '视频分析授权'],
        sections: [
            {
                title: '数据收集范围',
                content: '我们仅收集与康复训练相关的数据，包括您上传的视频、动作类型、训练时长和分析结果。这些信息用于训练服务，包括动作分析、训练报告和记录管理。',
            },
            {
                title: '数据使用目的',
                content: '训练视频用于动作分析和训练服务。授权人员可在工作需要时查看相关视频和结果。',
            },
            {
                title: '数据存储与保护',
                content: '系统通过权限控制保护训练数据。授权医护人员和系统服务可在工作需要时访问相关数据。',
            },
            {
                title: '视频分析授权',
                content: '上传并分析训练视频需要视频分析授权。首次登录时会创建授权记录，您可在本页查看当前状态。',
            },
        ],
    },
    onShow() {
        this.setData({ displayMode: (0, session_1.getDisplayMode)() });
        this.loadConsentStatus();
    },
    async loadConsentStatus() {
        this.setData({ consentStatusLoaded: false, consentStatusText: '正在获取授权状态…' });
        try {
            const status = await (0, me_1.getPrivacyConsent)();
            this.setData({
                consented: status.consented,
                consentStatusLoaded: true,
                consentStatusText: status.consented ? '已同意视频分析授权' : '尚未同意视频分析授权',
            });
        }
        catch (_error) {
            this.setData({ consentStatusLoaded: false, consentStatusText: '暂时无法获取授权状态，请登录后重试' });
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

});
