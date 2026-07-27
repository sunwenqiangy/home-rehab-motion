import { request } from '@/utils/request';

/** 账号信息 */
export interface AccountItem {
  accountId: number;
  username: string;
  role: 'admin' | 'nurse' | string;
  status: 0 | 1;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccountPayload {
  username: string;
  password: string;
  role: 'admin' | 'nurse';
  displayName?: string;
}

export interface UpdateAccountPayload {
  role?: 'admin' | 'nurse';
  status?: 0 | 1;
  displayName?: string;
}

/** 获取账号列表 */
export function getAccountList(): Promise<AccountItem[]> {
  return request<AccountItem[]>({
    url: '/admin/accounts',
    method: 'GET',
  });
}

/** 创建账号 */
export function createAccount(data: CreateAccountPayload): Promise<AccountItem> {
  return request<AccountItem>({
    url: '/admin/accounts',
    method: 'POST',
    data,
  });
}

/** 更新账号角色/状态/显示名 */
export function updateAccount(accountId: number, data: UpdateAccountPayload): Promise<AccountItem> {
  return request<AccountItem>({
    url: `/admin/accounts/${accountId}`,
    method: 'PATCH',
    data,
  });
}

/** 重置账号密码 */
export function resetAccountPassword(accountId: number, password: string): Promise<{ accountId: number; reset: boolean }> {
  return request<{ accountId: number; reset: boolean }>({
    url: `/admin/accounts/${accountId}/password`,
    method: 'PATCH',
    data: { password },
  });
}

/** 删除账号 */
export function deleteAccount(accountId: number): Promise<{ accountId: number; removed: boolean }> {
  return request<{ accountId: number; removed: boolean }>({
    url: `/admin/accounts/${accountId}`,
    method: 'DELETE',
  });
}
