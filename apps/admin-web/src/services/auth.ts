import { request } from '@/utils/request';
import type { AdminLoginRequestDto, AdminLoginResponseDto } from '@home-rehab-motion/shared-contract';

export function adminLogin(data: AdminLoginRequestDto): Promise<AdminLoginResponseDto> {
  return request<AdminLoginResponseDto>({
    url: '/admin/auth/login',
    method: 'POST',
    data,
  });
}
