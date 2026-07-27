import { request } from '@/utils/request';
import type {
  GoldTemplateGenerateRequestDto,
  GoldTemplateGenerateResponseDto,
  GoldTemplateSaveRequestDto,
  GoldTemplateSaveResponseDto,
  GoldTemplateSourceVideoListResponseDto,
  GoldTemplateVersionListResponseDto,
  GoldTemplateVersionStatusUpdateRequestDto,
  GoldTemplateVersionStatusUpdateResponseDto,
  MotivationRulesDto,
  PatientAppConfigDto,
  ThresholdConfigDto,
  UpdatePatientAppConfigRequestDto,
} from '@home-rehab-motion/shared-contract';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';

/** 获取所有阈值配置 */
export function getThresholds(): Promise<ThresholdConfigDto[]> {
  return request<ThresholdConfigDto[]>({
    url: '/admin/thresholds',
    method: 'GET',
  });
}

/** 更新某动作类型的阈值配置 */
export function updateThreshold(actionType: TrainingActionType, thresholdConfig: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>({
    url: `/admin/thresholds/${actionType}`,
    method: 'PUT',
    data: { thresholdConfig },
  });
}

/** 获取可用于提模的已完成分析视频 */
export function getGoldTemplateSourceVideos(actionType?: TrainingActionType): Promise<GoldTemplateSourceVideoListResponseDto> {
  return request<GoldTemplateSourceVideoListResponseDto>({
    url: '/admin/thresholds/gold-templates/source-videos',
    method: 'GET',
    params: actionType ? { actionType } : undefined,
  });
}

/** 运行提模计算（不落库） */
export function generateGoldTemplate(payload: GoldTemplateGenerateRequestDto): Promise<GoldTemplateGenerateResponseDto> {
  return request<GoldTemplateGenerateResponseDto>({
    url: '/admin/thresholds/gold-templates/generate',
    method: 'POST',
    data: payload,
  });
}

/** 保存新金标准版本 */
export function saveGoldTemplate(payload: GoldTemplateSaveRequestDto): Promise<GoldTemplateSaveResponseDto> {
  return request<GoldTemplateSaveResponseDto>({
    url: '/admin/thresholds/gold-templates',
    method: 'POST',
    data: payload,
  });
}

/** 查询金标准版本列表 */
export function getGoldTemplateVersions(params?: {
  actionType?: TrainingActionType;
  status?: number;
  limit?: number;
}): Promise<GoldTemplateVersionListResponseDto> {
  return request<GoldTemplateVersionListResponseDto>({
    url: '/admin/thresholds/gold-templates',
    method: 'GET',
    params,
  });
}

/** 更新版本状态（0=停用,1=启用） */
export function updateGoldTemplateVersionStatus(
  templateId: number,
  payload: GoldTemplateVersionStatusUpdateRequestDto,
): Promise<GoldTemplateVersionStatusUpdateResponseDto> {
  return request<GoldTemplateVersionStatusUpdateResponseDto>({
    url: `/admin/thresholds/gold-templates/${templateId}/status`,
    method: 'PUT',
    data: payload,
  });
}

/** 获取激励规则 */
export function getMotivationRules(): Promise<MotivationRulesDto> {
  return request<MotivationRulesDto>({
    url: '/admin/thresholds/motivation-rules',
    method: 'GET',
  });
}

/** 更新激励规则 */
export function updateMotivationRules(payload: Partial<MotivationRulesDto>): Promise<MotivationRulesDto> {
  return request<MotivationRulesDto>({
    url: '/admin/thresholds/motivation-rules',
    method: 'PUT',
    data: payload,
  });
}

/** 获取患者端应用配置 */
export function getPatientAppConfig(): Promise<PatientAppConfigDto> {
  return request<PatientAppConfigDto>({
    url: '/admin/thresholds/patient-app-config',
    method: 'GET',
  });
}

/** 更新患者端应用配置 */
export function updatePatientAppConfig(payload: UpdatePatientAppConfigRequestDto): Promise<PatientAppConfigDto> {
  return request<PatientAppConfigDto>({
    url: '/admin/thresholds/patient-app-config',
    method: 'PUT',
    data: payload,
  });
}
