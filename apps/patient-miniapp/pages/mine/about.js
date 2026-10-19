"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_1 = require("../../store/session");
Page({
    data: {
        displayMode: 'elderly',
        appName: '居家康复训练助手',
        description: '在家查看动作指导，记录每天的练习，并回顾动作表现。',
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
