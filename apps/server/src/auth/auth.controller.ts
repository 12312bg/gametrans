import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AUTH_COOKIE, config } from '../config';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService, PUBLIC_USER_SELECT } from './auth.service';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private async setCookie(res: Response, userId: string) {
    const token = await this.auth.sign(userId);
    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.jwtExpiresDays * 24 * 3600 * 1000,
      path: '/',
    });
  }

  @ApiOperation({ summary: '站点配置', description: '是否开放注册、谁可以创建项目。无需登录。' })
  @Public()
  @Get('config')
  siteConfig() {
    return { allowRegistration: config.allowRegistration, projectCreation: config.projectCreation };
  }

  @ApiOperation({ summary: '注册', description: '注册成功后自动登录（写入 Cookie）。' })
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(dto);
    await this.setCookie(res, user.id);
    return user;
  }

  @ApiOperation({ summary: '登录', description: '使用用户名或邮箱登录，成功后写入 httpOnly Cookie `gt_token`。' })
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validate(dto);
    await this.setCookie(res, user.id);
    return this.prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT });
  }

  @ApiOperation({ summary: '退出登录', description: '清除登录 Cookie。' })
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @ApiOperation({ summary: '当前用户', description: '未登录时返回 null。使用 API 令牌时 `authMethod` 为 `token`，并返回令牌的权限范围与有效期。' })
  @Public()
  @Get('me')
  async me(@CurrentUser() user?: AuthUser) {
    if (!user) return null;
    const [profile, invitations] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT }),
      this.prisma.invitation.count({ where: { inviteeId: user.id, status: 'PENDING' } }),
    ]);
    return {
      ...profile,
      // 使用 API 令牌时不具备超级管理员权限
      isSuperAdmin: user.token ? false : profile?.isSuperAdmin,
      pendingInvitations: invitations,
      authMethod: user.token ? 'token' : 'session',
      token: user.token ? { scope: user.token.scope, projectId: user.token.projectId, expiresAt: user.token.expiresAt } : undefined,
    };
  }
}
