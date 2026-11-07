import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { AuthService, PUBLIC_USER_SELECT } from '../auth/auth.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { pageParams } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

class UpdateMeDto {
  @IsOptional() @IsString() @Length(1, 32) displayName?: string;
  @IsOptional() @IsString() @Length(0, 500) bio?: string;
  @IsOptional() @IsEmail({}, { message: '邮箱格式不正确' }) email?: string;
}

class ChangePasswordDto {
  @IsString() oldPassword: string;
  @IsString() @Length(8, 72, { message: '密码长度为 8-72 个字符' }) newPassword: string;
}

class AdminUpdateUserDto {
  @IsOptional() @IsBoolean() isSuperAdmin?: boolean;
  @IsOptional() @IsBoolean() isBanned?: boolean;
}

class ResetPasswordDto {
  @IsString() @Length(8, 72, { message: '密码长度为 8-72 个字符' }) password: string;
}

@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Patch('users/me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    if (dto.email) {
      const email = dto.email.toLowerCase();
      const dup = await this.prisma.user.findFirst({ where: { email, NOT: { id: user.id } } });
      if (dup) throw new ConflictException('该邮箱已被注册');
      dto.email = email;
    }
    return this.prisma.user.update({ where: { id: user.id }, data: dto, select: PUBLIC_USER_SELECT });
  }

  @Post('users/me/password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.oldPassword, dto.newPassword);
    return { ok: true };
  }

  /** 邀请成员时的用户搜索 */
  @Get('users/search')
  search(@Query('q') q = '') {
    const term = q.trim();
    if (!term) return [];
    return this.prisma.user.findMany({
      where: {
        isBanned: false,
        OR: [
          { username: { contains: term, mode: 'insensitive' } },
          { displayName: { contains: term, mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, displayName: true },
      take: 10,
      orderBy: { username: 'asc' },
    });
  }

  @Get('users/:username')
  async profile(@Param('username') username: string, @CurrentUser() viewer: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, displayName: true, bio: true, createdAt: true },
    });
    if (!user) throw new BadRequestException('用户不存在');
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId: user.id,
        project: viewer.isSuperAdmin ? {} : { OR: [{ visibility: 'PUBLIC' }, { members: { some: { userId: viewer.id } } }] },
      },
      include: { project: { select: { id: true, name: true, engine: true, targetLang: true } } },
      orderBy: { joinedAt: 'desc' },
    });
    const [translated, reviewed] = await Promise.all([
      this.prisma.entry.count({ where: { translatorId: user.id } }),
      this.prisma.entry.count({ where: { reviewerId: user.id } }),
    ]);
    return { ...user, memberships, stats: { translated, reviewed } };
  }

  // ───────── 超级管理员 ─────────

  private ensureAdmin(user: AuthUser) {
    if (!user.isSuperAdmin) throw new ForbiddenException('仅超级管理员可访问');
  }

  @Get('admin/stats')
  async adminStats(@CurrentUser() user: AuthUser) {
    this.ensureAdmin(user);
    const [users, projects, entries, files] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.project.count(),
      this.prisma.entry.count(),
      this.prisma.file.count(),
    ]);
    return { users, projects, entries, files };
  }

  @Get('admin/users')
  async adminUsers(@CurrentUser() user: AuthUser, @Query('q') q = '', @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    this.ensureAdmin(user);
    const { skip, take, ...p } = pageParams(page, pageSize);
    const where = q.trim()
      ? {
          OR: [
            { username: { contains: q.trim(), mode: 'insensitive' as const } },
            { email: { contains: q.trim(), mode: 'insensitive' as const } },
            { displayName: { contains: q.trim(), mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: { ...PUBLIC_USER_SELECT, isBanned: true, _count: { select: { memberships: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, ...p };
  }

  @Patch('admin/users/:id')
  async adminUpdate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    this.ensureAdmin(user);
    if (id === user.id && (dto.isSuperAdmin === false || dto.isBanned)) {
      throw new BadRequestException('不能取消自己的超级管理员身份或封禁自己');
    }
    return this.prisma.user.update({ where: { id }, data: dto, select: { ...PUBLIC_USER_SELECT, isBanned: true } });
  }

  @Post('admin/users/:id/reset-password')
  async adminResetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    this.ensureAdmin(user);
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await this.auth.hash(dto.password) } });
    return { ok: true };
  }
}
