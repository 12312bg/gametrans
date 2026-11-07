import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AUTH_COOKIE } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthedRequest, IS_PUBLIC } from './decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const token: string | undefined = req.cookies?.[AUTH_COOKIE];
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, username: true, displayName: true, email: true, isSuperAdmin: true, isBanned: true },
        });
        if (user && !user.isBanned) {
          const { isBanned: _b, ...rest } = user;
          req.user = rest;
        }
      } catch {
        /* 无效或过期的凭证按未登录处理 */
      }
    }
    if (!req.user && !isPublic) throw new UnauthorizedException('请先登录');
    return true;
  }
}
