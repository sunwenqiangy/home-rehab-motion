"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFeedback = createFeedback;
exports.getPatientFeedbackList = getPatientFeedbackList;
exports.getPatientFeedbackDetail = getPatientFeedbackDetail;
exports.appendPatientFeedbackMessage = appendPatientFeedbackMessage;
exports.getFeedbackImageUploadTarget = getFeedbackImageUploadTarget;
exports.uploadFeedbackImage = uploadFeedbackImage;
const session_1 = require("../store/session");
const request_1 = require("../utils/request");
function createFeedback(payload) {
    return (0, request_1.request)({
        url: '/feedback',
        method: 'POST',
        data: payload,
    });
}
function getPatientFeedbackList() {
    return (0, request_1.request)({
        url: '/feedback',
    });
}
function getPatientFeedbackDetail(feedbackId) {
    return (0, request_1.request)({
        url: `/feedback/${feedbackId}`,
    });
}
function appendPatientFeedbackMessage(feedbackId, payload) {
    return (0, request_1.request)({
        url: `/feedback/${feedbackId}/messages`,
        method: 'POST',
        data: payload,
    });
}
function getFeedbackImageUploadTarget() {
    return (0, request_1.request)({
        url: '/feedback/presign-upload',
    });
}
function uploadFeedbackImage(uploadUrl, objectKey, filePath) {
    return new Promise((resolve, reject) => {
        wx.uploadFile({
            url: uploadUrl,
            filePath,
            name: 'file',
            formData: { objectKey },
            timeout: 120000,
            header: {
                Authorization: (0, session_1.getToken)() ? `Bearer ${(0, session_1.getToken)()}` : '',
            },
            success: (response) => {
                try {
                    const payload = JSON.parse(response.data || '{}');
                    if (payload.success && payload.data) {
                        resolve(payload.data);
                        return;
                    }
                    reject(new Error(payload.message || 'Upload failed'));
                }
                catch (error) {
                    reject(error);
                }
            },
            fail: (error) => reject(error),
        });
    });
}
