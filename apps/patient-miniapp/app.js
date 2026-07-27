"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const appConfig_1 = require("./services/appConfig");
App({
    globalData: {
        displayMode: 'elderly',
        appConfig: { ...appConfig_1.DEFAULT_APP_CONFIG },
    },
    async onLaunch() {
        try {
            const cfg = await (0, appConfig_1.fetchAppConfig)();
            this.globalData.appConfig = cfg;
        }
        catch (_error) {
            // 请求失败时保留默认值，不影响正常使用
        }
    },
});
