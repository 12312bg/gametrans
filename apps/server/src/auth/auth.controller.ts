import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AUTH_COOKIE, config } from '../config';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { AuthService, PUBLIC_USER_SELECT } from './auth.service';

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

  @Public()
  @Get('config')
  siteConfig() {
    return { allowRegistration: config.allowRegistration, projectCreation: config.projectCreation };
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(dto);
    await this.setCookie(res, user.id);
    return user;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validate(dto);
    await this.setCookie(res, user.id);
    return this.prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT });
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Public()
  @Get('me')
  async me(@CurrentUser() user?: AuthUser) {
    if (!user) return null;
    const [profile, invitations] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT }),
      this.prisma.invitation.count({ where: { inviteeId: user.id, status: 'PENDING' } }),
    ]);
    return { ...profile, pendingInvitations: invitations };
  }
}
