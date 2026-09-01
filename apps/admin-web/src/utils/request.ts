import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

/** 后端统一响应体 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T;
  message?: string;
}

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

let redirectingAfterSessionExpiry = false;

type AuthenticationError = {
  code?: unknown;
  response?: { status?: unknown };
};

/** 判断接口错误是否意味着管理端登录凭证已失效。 */
export function isAuthenticationError(error: unknown): boolean {
  const authenticationError = error as AuthenticationError | undefined;
  return Number(authenticationError?.response?.status) === 401
    || authenticationError?.code === 'HTTP_401';
}

function handleSessionExpiry() {
  if (redirectingAfterSessionExpiry) return;

  redirectingAfterSessionExpiry = true;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_role');
  ElMessage.warning('登录状态已失效，请重新登录');

  const currentPath = window.location.hash.replace(/^#/, '');
  const loginPath = currentPath.startsWith('/login')
    ? '/login'
    : `/login?redirect=${encodeURIComponent(currentPath || '/dashboard')}`;
  window.location.hash = `#${loginPath}`;
}

/** 新登录成功后允许未来会话失效时再次触发全局处理。 */
export function resetSessionExpiryState() {
  redirectingAfterSessionExpiry = false;
}

/* ---------- 请求拦截：自动附带 Token ---------- */
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('admin_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/* ---------- 响应拦截：统一错误处理 ---------- */
http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (isAuthenticationError(err)) handleSessionExpiry();
    return Promise.reject(err);
  },
);

/** 通用请求方法 */
export async function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  const res = await http.request<ApiResponse<T>>(config);
  if (!res.data.success) {
    const error: any = new Error(res.data.message || '业务处理失败');
    error.code = (res.data as any).code;
    error.response = { data: res.data, status: res.status };
    if (isAuthenticationError(error)) handleSessionExpiry();
    throw error;
  }
  return res.data.data;
}

export default http;
