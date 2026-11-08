import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthUser, CurrentUser, SessionOnly } from '../common/decorators';
import { ChangePasswordDto, UpdateMeDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('用户')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @ApiOperation({ summary: '修改个人资料', description: '仅限网页登录调用；`locale` 为界面语言。' })
  @SessionOnly()
  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @ApiOperation({ summary: '修改密码', description: '仅限网页登录调用。' })
  @SessionOnly()
  @Post('me/password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.oldPassword, dto.newPassword);
    return { ok: true };
  }

  @ApiOperation({ summary: '搜索用户', description: '按用户名或昵称搜索，用于邀请成员，最多返回 10 条。' })
  @ApiQuery({ name: 'q', required: false, description: '关键字' })
  @Get('search')
  search(@Query('q') q = '') {
    return this.users.search(q);
  }

  @ApiOperation({ summary: '用户主页', description: '公开资料、参与的项目与贡献统计。' })
  @Get(':username')
  profile(@Param('username') username: string, @CurrentUser() viewer: AuthUser) {
    return this.users.profile(username, viewer);
  }
}
