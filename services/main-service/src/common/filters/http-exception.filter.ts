import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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

    response.status(status).json({
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
