import { HttpException } from '@nestjs/common';
import { ERRORS, ErrorCode, Params } from '@gametrans/shared';
import type { ValidationError } from 'class-validator';

/** 业务异常：携带错误码与参数，由 AllExceptionsFilter 按请求语言翻译 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    readonly params?: Params,
    /** 附加到响应体的字段，如冲突时的最新数据 */
    readonly extra?: Record<string, unknown>,
  ) {
    super(code, ERRORS[code]);
  }
}

export const fail = (code: ErrorCode, params?: Params, extra?: Record<string, unknown>) => new AppException(code, params, extra);

/** DTO 校验失败：取第一条约束，装饰器的 message 填 i18n 键（validation.*） */
export function validationExceptionFactory(errors: ValidationError[]): AppException {
  const first = (list: ValidationError[], path: string[]): { field: string; message?: string } | undefined => {
    for (const e of list) {
      const field = [...path, e.property].join('.');
      const message = e.constraints ? Object.values(e.constraints)[0] : undefined;
      if (message) return { field, message };
      const nested = first(e.children ?? [], [...path, e.property]);
      if (nested) return nested;
    }
    return undefined;
  };
  const hit = first(errors, []) ?? { field: '?' };
  const messageKey = hit.message?.startsWith('validation.') ? hit.message : undefined;
  return fail('VALIDATION_FAILED', { field: hit.field }, messageKey ? { messageKey } : undefined);
}
