import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TokensService } from '../auth/tokens.service';
import { AUTH_COOKIE } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, AuthedRequest, IS_PUBLIC, SESSION_ONLY } from './decorators';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 全局认证守卫，支持两种方式：
 * 1. 网页登录：httpOnly Cookie（gt_token，JWT）
 * 2. 脚本调用：Authorization: Bearer <个人 API 令牌>
 *    - 只读令牌只能发起 GET/HEAD 请求
 *    - 限定项目的令牌只能访问 /api/projects/<该项目>/… 与 /api/auth/me
 *    - 不继承超级管理员权限；@SessionOnly 的接口不能使用令牌
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
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const sessionOnly = this.reflector.getAllAndOverride<boolean>(SESSION_ONLY, targets);

    const authz = req.headers.authorization;
    if (authz) {
      const m = /^Bearer\s+(\S+)$/i.exec(authz);
      if (!m) throw new UnauthorizedException('Authorization 头格式应为：Bearer <令牌>');
      req.user = await this.tokens.authenticate(m[1]);
      this.checkToken(req, req.user, sessionOnly);
      return true;
    }

    const cookie: string | undefined = req.cookies?.[AUTH_COOKIE];
    if (cookie) req.user = await this.fromCookie(cookie);
    if (!req.user && !isPublic) throw new UnauthorizedException('请先登录');
    return true;
  }

  private async fromCookie(token: string): Promise<AuthUser | undefined> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, username: true, displayName: true, email: true, isSuperAdmin: true, isBanned: true },
      });
      if (!user || user.isBanned) return undefined;
      const { isBanned: _b, ...rest } = user;
      return rest;
    } catch {
      return undefined; // 无效或过期的凭证按未登录处理
    }
  }

  private checkToken(req: AuthedRequest, user: AuthUser, sessionOnly: boolean | undefined) {
    const t = user.token!;
    if (sessionOnly) throw new ForbiddenException('该操作需要在网页登录后进行，不能使用 API 令牌');
    if (t.scope === 'READ' && !READ_METHODS.has(req.method)) throw new ForbiddenException('只读令牌不能执行写操作');
    if (t.projectId) {
      const path = (req.originalUrl || req.url).split('?')[0].replace(/\/+$/, '');
      const base = `/api/projects/${t.projectId}`;
      const allowed = path === base || path.startsWith(`${base}/`) || path === '/api/auth/me';
      if (!allowed) throw new ForbiddenException('该令牌仅限用于指定项目');
    }
  }
}
