import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TokensService } from '../auth/tokens.service';
import { AUTH_COOKIE } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, AuthedRequest, IS_PUBLIC, SESSION_ONLY } from './decorators';
import { fail } from './errors';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const USER_SELECT = { id: true, username: true, displayName: true, email: true, isSuperAdmin: true, isBanned: true, locale: true } as const;

/**
 * 全局认证：网页登录用 httpOnly Cookie（JWT），脚本用 Authorization: Bearer <API 令牌>。
 * 令牌：只读不可写、限定项目只能访问该项目、不继承超级管理员、不能访问 @SessionOnly 接口。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);

    const authz = req.headers.authorization;
    if (authz) {
      const m = /^Bearer\s+(\S+)$/i.exec(authz);
      if (!m) throw fail('BAD_AUTH_HEADER');
      req.user = await this.tokens.authenticate(m[1]);
      this.checkToken(req, req.user, meta<boolean>(SESSION_ONLY));
      return true;
    }

    const cookie: string | undefined = req.cookies?.[AUTH_COOKIE];
    if (cookie) req.user = await this.fromCookie(cookie);
    if (!req.user && !meta<boolean>(IS_PUBLIC)) throw fail('AUTH_REQUIRED');
    return true;
  }

  private async fromCookie(token: string): Promise<AuthUser | undefined> {
    try {
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({ where: { id: sub }, select: USER_SELECT });
      if (!user || user.isBanned) return undefined;
      const { isBanned: _b, ...rest } = user;
      return rest;
    } catch {
      return undefined; // 无效或过期的凭证按未登录处理
    }
  }

  private checkToken(req: AuthedRequest, user: AuthUser, sessionOnly?: boolean) {
    const t = user.token!;
    if (sessionOnly) throw fail('SESSION_ONLY');
    if (t.scope === 'READ' && !READ_METHODS.has(req.method)) throw fail('TOKEN_READ_ONLY');
    if (t.projectId) {
      const path = (req.originalUrl || req.url).split('?')[0].replace(/\/+$/, '');
      const base = `/api/projects/${t.projectId}`;
      if (path !== base && !path.startsWith(`${base}/`) && path !== '/api/auth/me') throw fail('TOKEN_PROJECT_SCOPE');
    }
  }
}
