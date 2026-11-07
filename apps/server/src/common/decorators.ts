import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
/** 允许未登录访问（若已登录仍会解析用户） */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SESSION_ONLY = 'sessionOnly';
/** 只允许网页登录（Cookie）访问，禁止使用 API 令牌，例如管理令牌、修改密码 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  /** 使用 API 令牌时恒为 false：令牌不继承超级管理员权限 */
  isSuperAdmin: boolean;
  /** 通过 API 令牌认证时存在 */
  token?: { id: string; scope: 'READ' | 'WRITE'; projectId: string | null; expiresAt: Date };
}

export type AuthedRequest = Request & { user?: AuthUser };

/** 当前登录用户；@Public 路由下可能为 undefined */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
