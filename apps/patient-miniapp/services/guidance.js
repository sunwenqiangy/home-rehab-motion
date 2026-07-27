"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGuidanceList = getGuidanceList;
exports.getGuidanceDetail = getGuidanceDetail;
const request_1 = require("../utils/request");
function getGuidanceList() {
    return (0, request_1.request)({
        url: '/guidance',
    });
}
function getGuidanceDetail(contentId) {
    return (0, request_1.request)({
        url: `/guidance/${contentId}`,
    });
}
