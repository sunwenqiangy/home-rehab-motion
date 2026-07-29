import { request } from '@/utils/request';
import type {
  AdminGuidanceListItemDto,
  AssetUploadTargetDto,
  GuidanceContentDto,
} from '@home-rehab-motion/shared-contract';

export function getGuidanceList(): Promise<AdminGuidanceListItemDto[]> {
  return request<AdminGuidanceListItemDto[]>({ url: '/admin/guidance', method: 'GET' });
}

/** 管理端和患者端读取同一份已上线内容。 */
export function getGuidanceDetail(contentId: number): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/guidance/${contentId}`, method: 'GET' });
}

/** 新建即上线；服务端会校验患者端所需内容。 */
export function createGuidance(data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: '/admin/guidance', method: 'POST', data });
}

/** 保存修改即上线；服务端会校验患者端所需内容。 */
export function updateGuidance(id: number, data: Record<string, unknown>): Promise<GuidanceContentDto> {
  return request<GuidanceContentDto>({ url: `/admin/guidance/${id}`, method: 'PUT', data });
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
