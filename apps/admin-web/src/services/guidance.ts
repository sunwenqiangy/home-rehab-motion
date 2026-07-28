import { request } from '@/utils/request';
import type {
  AdminGuidanceListItemDto,
  AssetUploadTargetDto,
  GuidanceContentDto,
  GuidanceValidationResultDto,
  GuidanceVersionDto,
} from '@home-rehab-motion/shared-contract';

export function getGuidanceList(): Promise<AdminGuidanceListItemDto[]> {
  return request<AdminGuidanceListItemDto[]>({ url: '/admin/guidance', method: 'GET' });
}

/** 患者侧已发布内容，仅用于只读预览。 */
export function getGuidanceDetail(contentId: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/guidance/${contentId}`, method: 'GET' });
}

export function getGuidanceDraft(contentId: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${contentId}/draft`, method: 'GET' });
}

export function createGuidance(data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: '/admin/guidance', method: 'POST', data });
}

export function saveGuidanceDraft(id: number, data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${id}/draft`, method: 'PUT', data });
}

/** 兼容历史调用：更新始终只保存草稿，不会直接发布。 */
export function updateGuidance(id: number, data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return saveGuidanceDraft(id, data);
}

export function validateGuidance(id: number): Promise<GuidanceValidationResultDto> {
  return request<GuidanceValidationResultDto>({ url: `/admin/guidance/${id}/validate`, method: 'POST' });
}

export function publishGuidance(id: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${id}/publish`, method: 'POST' });
}

export function deleteGuidance(id: number): Promise<void> {
  return request<void>({ url: `/admin/guidance/${id}`, method: 'DELETE' });
}

export function getGuidanceVersions(id: number): Promise<GuidanceVersionDto[]> {
  return request<GuidanceVersionDto[]>({ url: `/admin/guidance/${id}/versions`, method: 'GET' });
}

export function rollbackGuidance(id: number, version: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${id}/rollback`, method: 'POST', data: { version } });
}

export function presignUpload(
fileName?: string,
mediaKind: 'image' | 'video' = 'image',
contentType?: string,
): Promise<AssetUploadTargetDto> {
return request<AssetUploadTargetDto>({
url: '/admin/guidance/presign-upload',
method: 'GET',
params: { fileName, mediaKind, contentType },
});
}

