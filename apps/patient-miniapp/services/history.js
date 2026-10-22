"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHistoryVideos = getHistoryVideos;
const request_1 = require("../utils/request");
function getHistoryVideos(page = 1, pageSize = 20) {
    return (0, request_1.request)({
        url: `/history/videos?page=${page}&pageSize=${pageSize}`,
    });
}
