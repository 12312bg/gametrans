import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { ApproveDto, InviteDto, JoinRequestDto, RoleDto } from './members.dto';
import { MembersService } from './members.service';

const OK = { ok: true };

@ApiTags('成员与邀请')
@Controller()
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly access: AccessService,
  ) {}

  private manage(user: AuthUser, pid: string) {
    return this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
  }

  @ApiOperation({ summary: '成员列表', description: '含每位成员的翻译 / 审核数。' })
  @Public()
  @Get('projects/:pid/members')
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.members.list(pid);
  }

  @ApiOperation({ summary: '修改成员角色', description: '管理员只能管理比自己低的角色。' })
  @Patch('projects/:pid/members/:uid')
  async changeRole(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('uid') uid: string, @Body() dto: RoleDto) {
    return this.members.changeRole(await this.manage(user, pid), uid, dto.role);
  }

  @ApiOperation({ summary: '移除成员 / 退出项目', description: 'uid 为自己时表示退出；所有者不能退出。' })
  @Delete('projects/:pid/members/:uid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('uid') uid: string) {
    await this.members.remove(await this.access.context(user, pid), uid);
    return OK;
  }

  @ApiOperation({ summary: '申请加入', description: '仅公开项目。' })
  @Post('projects/:pid/join-requests')
  async requestJoin(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: JoinRequestDto) {
    return this.members.requestJoin(await this.access.context(user, pid), user, dto.message);
  }

  @ApiOperation({ summary: '撤回我的申请' })
  @Delete('projects/:pid/join-requests/mine')
  async cancelMine(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.members.cancelMine(pid, user.id);
    return OK;
  }

  @ApiOperation({ summary: '加入申请列表', description: '需要成员管理权限。' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELED'] })
  @Get('projects/:pid/join-requests')
  async listRequests(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Query('status') status = 'PENDING') {
    await this.manage(user, pid);
    return this.members.listRequests(pid, status);
  }

  @ApiOperation({ summary: '批准加入申请', description: '可指定角色，默认翻译员。' })
  @Post('projects/:pid/join-requests/:rid/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('rid') rid: string, @Body() dto: ApproveDto) {
    await this.members.approve(await this.manage(user, pid), rid, dto.role);
    return OK;
  }

  @ApiOperation({ summary: '拒绝加入申请' })
  @Post('projects/:pid/join-requests/:rid/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('rid') rid: string) {
    await this.members.reject(await this.manage(user, pid), rid);
    return OK;
  }

  @ApiOperation({ summary: '邀请成员', description: '按用户名或邮箱邀请，对方接受后加入。' })
  @Post('projects/:pid/invitations')
  async invite(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: InviteDto) {
    return this.members.invite(await this.manage(user, pid), dto.username, dto.role);
  }

  @ApiOperation({ summary: '已发出的邀请' })
  @Get('projects/:pid/invitations')
  async listInvitations(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.manage(user, pid);
    return this.members.listInvitations(pid);
  }

  @ApiOperation({ summary: '撤回邀请' })
  @Delete('projects/:pid/invitations/:iid')
  async cancelInvitation(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('iid') iid: string) {
    await this.manage(user, pid);
    await this.members.cancelInvitation(pid, iid);
    return OK;
  }

  @ApiOperation({ summary: '我收到的邀请' })
  @Get('invitations')
  myInvitations(@CurrentUser() user: AuthUser) {
    return this.members.myInvitations(user.id);
  }

  @ApiOperation({ summary: '接受 / 拒绝邀请' })
  @ApiParam({ name: 'action', enum: ['accept', 'decline'] })
  @Post('invitations/:iid/:action')
  respond(@CurrentUser() user: AuthUser, @Param('iid') iid: string, @Param('action') action: string) {
    return this.members.respond(user, iid, action);
  }
}
