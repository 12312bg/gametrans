import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { ApiPaging } from '../common/api.models';
import { AuthUser, CurrentUser } from '../common/decorators';
import { fail } from '../common/errors';
import { AdminUpdateUserDto, ResetPasswordDto } from './users.dto';
import { UsersService } from './users.service';

const ensureAdmin = (user: AuthUser) => {
  if (!user.isSuperAdmin) throw fail('SUPERADMIN_ONLY');
};

@ApiTags('管理后台')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @ApiOperation({ summary: '全站统计', description: '仅超级管理员（网页登录）。' })
  @Get('stats')
  stats(@CurrentUser() user: AuthUser) {
    ensureAdmin(user);
    return this.users.stats();
  }

  @ApiOperation({ summary: '用户列表', description: '仅超级管理员（网页登录）。' })
  @ApiQuery({ name: 'q', required: false, description: '按用户名 / 邮箱 / 昵称搜索' })
  @ApiPaging()
  @Get('users')
  list(@CurrentUser() user: AuthUser, @Query('q') q = '', @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    ensureAdmin(user);
    return this.users.list(q, page, pageSize);
  }

  @ApiOperation({ summary: '封禁 / 解封、设置超级管理员', description: '仅超级管理员（网页登录）。' })
  @Patch('users/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AdminUpdateUserDto) {
    ensureAdmin(user);
    return this.users.update(user, id, dto);
  }

  @ApiOperation({ summary: '重置用户密码', description: '仅超级管理员（网页登录）。' })
  @Post('users/:id/reset-password')
  async resetPassword(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ResetPasswordDto) {
    ensureAdmin(user);
    await this.auth.resetPassword(id, dto.password);
    return { ok: true };
  }
}
