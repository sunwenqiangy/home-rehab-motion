import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : undefined;
    const details = typeof exceptionResponse === 'object' && exceptionResponse !== null
      ? exceptionResponse as Record<string, unknown>
      : {};
    const message = typeof exceptionResponse === 'string'
      ? exceptionResponse
      : typeof details.message === 'string'
        ? details.message
        : '服务暂时不可用，请稍后重试。';

    // 客户端不暴露内部细节，但所有 5xx 必须写入服务端日志，便于按请求路径和时间定位。
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const technicalDetail = exception instanceof Error
        ? exception.stack || exception.message
        : JSON.stringify(exception);
      this.logger.error(
        `${request.method} ${request.url} failed with HTTP ${status}: ${technicalDetail}`,
      );
    }

    // 参数校验、资源状态等可预期业务异常通过统一响应体返回 200，
    // 前端据 success/code/message 展示业务提示；认证/授权与系统故障仍保留真实 HTTP 状态。
    const responseStatus = [HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.UNPROCESSABLE_ENTITY]
      .includes(status) ? HttpStatus.OK : status;
    response.status(responseStatus).json({
      success: false,
      path: request.url,
      code: typeof details.code === 'string' ? details.code : `HTTP_${status}`,
      message,
      ...(process.env.NODE_ENV !== 'production' && details.detail
        ? { detail: details.detail }
        : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
