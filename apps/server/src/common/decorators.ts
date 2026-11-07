import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
/** 允许未登录访问（若已登录仍会解析用户） */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  isSuperAdmin: boolean;
}

export type AuthedRequest = Request & { user?: AuthUser };

/** 当前登录用户；@Public 路由下可能为 undefined */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
