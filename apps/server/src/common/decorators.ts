import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'isPublic';
/** 允许未登录访问（已登录时仍会解析用户） */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const READ_ONLY_POST = 'readOnlyPost';
/** 用 POST 传参但不修改数据的查询接口：只读令牌也可以调用 */
export const ReadOnlyPost = () => SetMetadata(READ_ONLY_POST, true);

export const SESSION_ONLY = 'sessionOnly';
/** 只允许网页登录访问，禁止 API 令牌（管理令牌、修改密码与资料） */
export const SessionOnly = () => SetMetadata(SESSION_ONLY, true);

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  /** 使用 API 令牌时恒为 false */
  isSuperAdmin: boolean;
  locale?: string | null;
  /** 通过 API 令牌认证时存在 */
  token?: { id: string; scope: 'READ' | 'WRITE'; projectId: string | null; expiresAt: Date };
}

export type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
