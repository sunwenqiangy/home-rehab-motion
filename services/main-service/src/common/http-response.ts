export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export function ok<T>(data: T, message?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    message,
  };
}
