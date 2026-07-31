import { request } from '@/utils/request';
import type {
  AdminGuidanceListItemDto,
  AssetUploadTargetDto,
  GuidanceContentDto,
} from '@home-rehab-motion/shared-contract';

export interface GuidanceConfigPackage {
  format: 'home-rehab-motion.guidance-config';
  version: 1;
  exportedAt: string;
  items: Array<{ actionType: string; title: string; snapshot: Record<string, unknown> }>;
}

export interface GuidanceConfigImportResult {
  imported: string[];
  skipped: string[];
  invalid: string[];
}

export function exportGuidanceConfigPackage(): Promise<GuidanceConfigPackage> {
  return request<GuidanceConfigPackage>({ url: '/admin/guidance/config-package', method: 'GET' });
}

export function importGuidanceConfigPackage(payload: GuidanceConfigPackage): Promise<GuidanceConfigImportResult> {
  return request<GuidanceConfigImportResult>({ url: '/admin/guidance/config-package/import', method: 'POST', data: payload });
}

export function getGuidanceList(): Promise<AdminGuidanceListItemDto[]> {
  return request<AdminGuidanceListItemDto[]>({ url: '/admin/guidance', method: 'GET' });
}

export function getGuidance(contentId: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${contentId}`, method: 'GET' });
}

export function updateGuidance(contentId: number, data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${contentId}`, method: 'PUT', data });
}

export function setGuidanceEnabled(contentId: number, enabled: boolean): Promise<{ contentId: number; enabled: boolean }> {
  return request<{ contentId: number; enabled: boolean }>({ url: `/admin/guidance/${contentId}/enabled`, method: 'POST', data: { enabled } });
}

export function copyGuidance(contentId: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${contentId}/copy`, method: 'POST' });
}

export function getGuidanceDetail(contentId: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/guidance/${contentId}`, method: 'GET' });
}

/** 新建内容默认下线，保存后可在列表启用。 */
export function createGuidance(data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: '/admin/guidance', method: 'POST', data });
}

export function deleteGuidance(id: number): Promise<void> {
  return request<void>({ url: `/admin/guidance/${id}`, method: 'DELETE' });
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
