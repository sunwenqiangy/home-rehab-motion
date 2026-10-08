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
 * admin / nurse: 除开发工具外均可使用
 * 开发工具（流程验证、金标准提取）仅管理员可用
 */
export const PERMISSION_MAP: Record<string, UserRole[]> = {
  'dashboard': ['admin', 'nurse'],
  'videos': ['admin', 'nurse'],
  'patients': ['admin', 'nurse'],
  'flow-verify': ['admin'],
  'guidance': ['admin', 'nurse'],
  'feedback': ['admin', 'nurse'],
  'thresholds': ['admin', 'nurse'],
  'gold-templates': ['admin'],
  'template-versions': ['admin', 'nurse'],
  'motivation-rules': ['admin', 'nurse'],
  'patient-config': ['admin', 'nurse'],
  'accounts': ['admin', 'nurse'],
};

export function hasPermission(menuKey: string): boolean {
  const allowed = PERMISSION_MAP[menuKey];
  if (!allowed) return true;
  return allowed.includes(getCurrentRole());
}
