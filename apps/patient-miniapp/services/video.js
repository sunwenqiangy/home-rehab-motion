"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPresignUpload = getPresignUpload;
exports.uploadVideoFile = uploadVideoFile;
exports.confirmUpload = confirmUpload;
exports.getVideoStatus = getVideoStatus;
const session_1 = require("../store/session");
const request_1 = require("../utils/request");
/** 上传失败时不静默创建登录态；失效会由请求层清理 Token 并回到登录页。 */
async function uploadWithRelogin(uploadTarget, filePath) {
    return doUploadFile(uploadTarget, filePath);
}
function getPresignUpload() {
    return (0, request_1.request)({
        url: '/videos/presign-upload',
    });
}
/** 实际执行 wx.uploadFile，抽取为独立函数以支持重试 */
function doUploadFile(uploadTarget, filePath) {
    return new Promise((resolve, reject) => {
        const uploadUrl = uploadTarget.uploadUrl;
        wx.uploadFile({
            url: uploadUrl,
            filePath,
            name: uploadTarget.uploadType === 's3_post' ? 'file' : 'file',
            timeout: 120000,
            header: uploadTarget.uploadType === 's3_post'
                ? {}
                : {
                    Authorization: (0, session_1.getToken)() ? `Bearer ${(0, session_1.getToken)()}` : '',
                },
            formData: uploadTarget.uploadType === 's3_post' ? uploadTarget.uploadFields || {} : undefined,
            success: (response) => {
                try {
                    if (uploadTarget.uploadType === 's3_post') {
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            resolve({ objectKey: uploadTarget.objectKey, size: 0 });
                            return;
                        }
                        const error = new Error(`视频上传失败（HTTP ${response.statusCode}）`);
                        console.error('[视频直传失败]', {
                            url: uploadUrl,
                            uploadType: uploadTarget.uploadType,
                            statusCode: response.statusCode,
                            response: response.data,
                        });
                        reject(error);
                        return;
                    }
                    // local_proxy 模式：401 时用特殊错误标记以便上层重试
                    if (response.statusCode === 401) {
                        reject(new Error('401 Unauthorized'));
                        return;
                    }
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
            fail: (error) => {
                const message = error?.errMsg || '视频上传网络请求失败';
                console.error('[视频上传网络失败]', {
                    url: uploadUrl,
                    uploadType: uploadTarget.uploadType,
                    error: message,
                });
                reject(new Error(`${message}（上传地址：${uploadUrl}）`));
            },
        });
    });
}
function uploadVideoFile(videoId, uploadTarget, filePath) {
    return uploadWithRelogin(uploadTarget, filePath);
}
function confirmUpload(payload) {
    return (0, request_1.request)({
        url: '/videos/confirm-upload',
        method: 'POST',
        data: payload,
    });
}
function getVideoStatus(videoId) {
    return (0, request_1.request)({
        url: `/videos/${videoId}/status`,
    });
}
