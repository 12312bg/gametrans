import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ErrorCode, Params, errorCodeForStatus } from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { config } from '../config';
import type { AuthedRequest } from './decorators';
import { AppException } from './errors';
import { requestLocale, translator } from './locale';

/** 统一错误响应：{ statusCode, code, message, params?, ...extra }，message 按请求语言翻译 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<AuthedRequest>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;
    const t = translator(requestLocale(req));

    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let params: Params | undefined;
    let extra: Record<string, unknown> = {};
    let messageKey: string | undefined;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      params = exception.params;
      const { messageKey: key, ...rest } = exception.extra ?? {};
      messageKey = typeof key === 'string' ? key : undefined;
      extra = rest;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = errorCodeForStatus(status);
      if (code === 'FILE_TOO_LARGE') params = { limit: config.uploadLimitMb };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError && ['P2025', 'P2002'].includes(exception.code)) {
      [status, code] = exception.code === 'P2025' ? [404, 'NOT_FOUND'] : [409, 'CONFLICT'];
    } else {
      this.logger.error((exception as Error)?.stack ?? String(exception));
    }

    res.status(status).json({
      statusCode: status,
      code,
      message: t(messageKey ?? `error.${code}`, params),
      ...(params ? { params } : {}),
      ...extra,
    });
  }
}
