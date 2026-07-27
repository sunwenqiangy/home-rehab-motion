"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReport = getReport;
const request_1 = require("../utils/request");
function getReport(videoId) {
    return (0, request_1.request)({
        url: `/reports/${videoId}`,
    });
}
