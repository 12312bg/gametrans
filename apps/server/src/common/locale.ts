import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { DEFAULT_LOCALE, Locale, isLocale, resolveLocale, translate } from '@gametrans/shared';
import type { AuthedRequest } from './decorators';

/** 请求语言：Accept-Language（网页端会设为界面语言）→ 账号设置 → 默认简体中文 */
export function requestLocale(req: AuthedRequest): Locale {
  const header = resolveLocale(req.headers?.['accept-language']);
  if (header) return header;
  return isLocale(req.user?.locale) ? req.user.locale : DEFAULT_LOCALE;
}

export type Translator = (key: string, params?: Record<string, unknown>) => string;

export const translator = (locale: Locale): Translator => (key, params) => translate(locale, key, params);

/** 控制器参数：当前请求语言的翻译函数 */
export const T = createParamDecorator((_: unknown, ctx: ExecutionContext): Translator => {
  return translator(requestLocale(ctx.switchToHttp().getRequest<AuthedRequest>()));
});
