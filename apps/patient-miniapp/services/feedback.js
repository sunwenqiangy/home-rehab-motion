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
function uploadFeedbackImage(uploadTarget, filePath) {
    const isDirectUpload = uploadTarget.uploadType === 's3_post';
    return new Promise((resolve, reject) => {
        wx.uploadFile({
            url: uploadTarget.uploadUrl,
            filePath,
            name: 'file',
            formData: isDirectUpload ? uploadTarget.uploadFields || {} : { objectKey: uploadTarget.objectKey },
            timeout: 120000,
            header: isDirectUpload
                ? {}
                : { Authorization: (0, session_1.getToken)() ? `Bearer ${(0, session_1.getToken)()}` : '' },
            success: (response) => {
                if (isDirectUpload) {
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        resolve({ objectKey: uploadTarget.objectKey, assetUrl: uploadTarget.assetUrl || '' });
                        return;
                    }
                    reject(new Error(`图片上传失败（HTTP ${response.statusCode}）`));
                    return;
                }
                try {
                    const payload = JSON.parse(response.data || '{}');
                    if (response.statusCode >= 200 && response.statusCode < 300 && payload.success && payload.data) {
                        resolve(payload.data);
                        return;
                    }
                    reject(new Error(payload.message || `图片上传失败（HTTP ${response.statusCode}）`));
                }
                catch (_error) {
                    reject(new Error(response.statusCode === 413
                        ? '图片文件过大，请选择小于 5MB 的图片。'
                        : `图片上传失败（HTTP ${response.statusCode}）`));
                }
            },
            fail: (error) => reject(error),
        });
    });
}
