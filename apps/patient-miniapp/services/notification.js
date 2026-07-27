"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotifications = getNotifications;
exports.getNotificationUnreadCount = getNotificationUnreadCount;
exports.markNotificationAsRead = markNotificationAsRead;
exports.markAllNotificationsAsRead = markAllNotificationsAsRead;
const request_1 = require("../utils/request");
function getNotifications() {
    return (0, request_1.request)({
        url: '/notifications',
    });
}
function getNotificationUnreadCount() {
    return (0, request_1.request)({
        url: '/notifications/unread-count',
    });
}
function markNotificationAsRead(notificationId) {
    return (0, request_1.request)({
        url: `/notifications/${notificationId}/read`,
        method: 'PATCH',
    });
}
function markAllNotificationsAsRead() {
    return (0, request_1.request)({
        url: '/notifications/read-all',
        method: 'POST',
    });
}
