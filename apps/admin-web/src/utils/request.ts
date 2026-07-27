import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

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
    const status = err?.response?.status;
    if (status === 401) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_role');
      window.location.hash = '#/login';
    }
    return Promise.reject(err);
  },
);

/** 通用请求方法 */
export async function request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
  const res = await http.request<ApiResponse<T>>(config);
  return res.data.data;
}

export default http;
