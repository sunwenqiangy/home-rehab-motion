import { request } from '@/utils/request';
import type { AdminFeedbackListItemDto, FeedbackDto } from '@home-rehab-motion/shared-contract';

export type ReplyTemplate = { code: string; label: string; content: string };
export type FeedbackPage = { items: AdminFeedbackListItemDto[]; total: number; page: number; limit: number };

export function getFeedbackList(safetyOnly = false, params: { keyword?: string; page?: number; limit?: number } = {}): Promise<FeedbackPage> {
  return request<FeedbackPage>({
    url: safetyOnly ? '/admin/feedback/safety-records' : '/admin/feedback',
    method: 'GET',
    params: { ...params, keyword: params.keyword?.trim() || undefined },
  });
}
export function getFeedbackDetail(feedbackId: number): Promise<AdminFeedbackListItemDto> {
  return request<AdminFeedbackListItemDto>({ url: `/admin/feedback/${feedbackId}`, method: 'GET' });
}
export function startFeedback(feedbackId: number): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>({ url: `/admin/feedback/${feedbackId}/start`, method: 'POST' });
}
export function replyFeedback(feedbackId: number, data: { content: string; templateCode?: string }): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>({ url: `/admin/feedback/${feedbackId}/reply`, method: 'POST', data });
}
export function closeFeedback(feedbackId: number): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>({ url: `/admin/feedback/${feedbackId}/close`, method: 'POST' });
}
export function batchCloseInactiveFeedback(): Promise<{ closedCount: number }> {
  return request<{ closedCount: number }>({ url: '/admin/feedback/batch-close', method: 'POST' });
}
export function getReplyTemplates(): Promise<ReplyTemplate[]> {
  return request<ReplyTemplate[]>({ url: '/admin/feedback/reply-templates', method: 'GET' });
}
