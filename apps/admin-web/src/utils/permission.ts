import type { UserRole } from '@home-rehab-motion/shared-types';

export function getCurrentRole(): UserRole {
  return (localStorage.getItem('admin_role') as UserRole) || 'nurse';
}

export function isAdmin(): boolean {
  return getCurrentRole() === 'admin';
}

export function isNurse(): boolean {
  return getCurrentRole() === 'nurse';
}

/**
 * 角色权限矩阵
 * admin: 全部功能
 * nurse: 视频记录、反馈管理（只读 + 回复）
 */
export const PERMISSION_MAP: Record<string, UserRole[]> = {
  'dashboard': ['admin', 'nurse'],
  'videos': ['admin', 'nurse'],
  'patients': ['admin', 'nurse'],
  'flow-verify': ['admin', 'nurse'],
  'guidance': ['admin'],
  'feedback': ['admin', 'nurse'],
  'thresholds': ['admin'],
  'gold-templates': ['admin'],
  'motivation-rules': ['admin'],
  'patient-config': ['admin'],
  'accounts': ['admin'],
};

export function hasPermission(menuKey: string): boolean {
  const allowed = PERMISSION_MAP[menuKey];
  if (!allowed) return true;
  return allowed.includes(getCurrentRole());
}
