"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_1 = require("../../store/session");
Page({
    data: {
        displayMode: 'elderly',
        appName: '安舒随行',
        description: '居家动作训练与记录工具，提供动作指导、短视频观察、练习记录和训练建议，帮助您按舒适节奏坚持每日练习。',
        features: [
            { icon: '🏋️', title: '动作观察', desc: '上传短视频，查看本段动作表现' },
            { icon: '📊', title: '训练记录', desc: '随时查看练习记录和训练报告' },
            { icon: '🏅', title: '坚持激励', desc: '记录连续练习，获得训练徽章' },
            { icon: '💬', title: '问题反馈', desc: '训练中有疑问时，可以提交反馈' },
        ],
    },
    onShow() {
        this.setData({ displayMode: (0, session_1.getDisplayMode)() });
    },
});
