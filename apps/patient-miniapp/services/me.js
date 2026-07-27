"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProfile = getProfile;
exports.getDisplaySettings = getDisplaySettings;
exports.getTrainingSummary = getTrainingSummary;
exports.getUserBadges = getUserBadges;
exports.getBadgeWall = getBadgeWall;
exports.updateDisplaySettings = updateDisplaySettings;
exports.updateProfile = updateProfile;
exports.bindWechatPhone = bindWechatPhone;
exports.getPrivacyConsent = getPrivacyConsent;
exports.grantPrivacyConsent = grantPrivacyConsent;
exports.withdrawPrivacyConsent = withdrawPrivacyConsent;
const request_1 = require("../utils/request");
function getProfile() {
    return (0, request_1.request)({
        url: '/me/profile',
    });
}
function getDisplaySettings() {
    return (0, request_1.request)({
        url: '/me/display-settings',
    });
}
function getTrainingSummary() {
    return (0, request_1.request)({
        url: '/me/training-summary',
    });
}
function getUserBadges() {
    return (0, request_1.request)({
        url: '/me/badges',
    });
}
function getBadgeWall() {
    return (0, request_1.request)({
        url: '/me/badge-wall',
    });
}
function getPrivacyConsent() {
    return (0, request_1.request)({
        url: '/me/privacy/consent',
    });
}
function grantPrivacyConsent() {
    return (0, request_1.request)({
        url: '/me/privacy/consent',
        method: 'POST',
    });
}
function withdrawPrivacyConsent() {
    return (0, request_1.request)({
        url: '/me/privacy/withdraw-consent',
        method: 'POST',
    });
}
function updateDisplaySettings(displayMode) {
    return (0, request_1.request)({
        url: '/me/display-settings',
        method: 'PUT',
        data: { displayMode },
    });
}
function updateProfile(nickname) {
    return (0, request_1.request)({
        url: '/me/profile',
        method: 'PUT',
        data: { nickname },
    });
}
function bindWechatPhone(code) {
    return (0, request_1.request)({
        url: '/me/phone/bind',
        method: 'POST',
        data: { code },
    });
}
