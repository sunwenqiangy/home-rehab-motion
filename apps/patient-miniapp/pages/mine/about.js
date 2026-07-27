"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_1 = require("../../store/session");
Page({
    data: {
        displayMode: 'elderly',
        version: 'V4 体验版',
        appName: '健康训练助手 · 患者端',
        description: '基于人工智能动作分析技术的腹肌康复训练辅助系统，帮助患者在家庭环境中完成标准化训练，实时获取动作评估和阶段化指导。',
        features: [
            { icon: '🏋️', title: '智能动作分析', desc: '自动识别训练动作，给出四维评分和改进建议' },
            { icon: '📊', title: '阶段化报告', desc: '根据康复阶段提供个性化训练建议和成长追踪' },
            { icon: '🏅', title: '徽章激励', desc: '连续训练达标即可解锁徽章，养成坚持习惯' },
            { icon: '👨‍⚕️', title: '医护反馈', desc: '对报告有疑问可一键提交，医护在线回复' },
        ],
        techInfo: [
            { label: '系统版本', value: '4.0.0-preview' },
            { label: '分析引擎', value: 'AI Motion Analysis v2' },
            { label: '数据存储', value: '加密云端存储' },
            { label: '技术支持', value: '健康训练团队' },
        ],
    },
    onShow() {
        this.setData({ displayMode: (0, session_1.getDisplayMode)() });
    },
});
