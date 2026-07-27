"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHistoryVideos = getHistoryVideos;
const request_1 = require("../utils/request");
function getHistoryVideos() {
    return (0, request_1.request)({
        url: '/history/videos',
    });
}
