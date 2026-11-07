import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PERMISSIONS, PROJECT_ROLES, ProjectRole, ROLE_LABELS, canManageMember } from '@gametrans/shared';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { AccessService, ProjectContext } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const ASSIGNABLE = PROJECT_ROLES.filter((r) => r !== 'OWNER') as string[];

class RoleDto {
  @IsIn(ASSIGNABLE, { message: '无效的角色' }) role: ProjectRole;
}

class JoinRequestDto {
  @IsOptional() @IsString() @Length(0, 500) message?: string;
}

class ApproveDto {
  @IsOptional() @IsIn(ASSIGNABLE, { message: '无效的角色' }) role?: ProjectRole;
}

class InviteDto {
  @IsString() @Length(1, 128) username: string;
  @IsIn(ASSIGNABLE, { message: '无效的角色' }) role: ProjectRole;
}

const USER_BRIEF = { id: true, username: true, displayName: true } as const;

@Controller()
export class MembersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  private assertGrant(ctx: ProjectContext, target: ProjectRole, newRole?: ProjectRole) {
    if (!canManageMember(ctx.role, ctx.isSuperAdmin, target, newRole)) {
      throw new ForbiddenException('只能管理比自己角色低的成员，且不能授予与自己同级或更高的角色');
    }
  }

  // ───────── 成员 ─────────

  @Public()
  @Get('projects/:pid/members')
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId: pid },
      include: { user: { select: USER_BRIEF } },
      orderBy: [{ joinedAt: 'asc' }],
    });
    const [translated, reviewed] = await Promise.all([
      this.prisma.entry.groupBy({ by: ['translatorId'], where: { projectId: pid, translation: { not: '' } }, _count: { _all: true } }),
      this.prisma.entry.groupBy({ by: ['reviewerId'], where: { projectId: pid, stage: { in: ['REVIEWED', 'LOCKED'] } }, _count: { _all: true } }),
    ]);
    const tMap = new Map(translated.map((t) => [t.translatorId, t._count._all]));
    const rMap = new Map(reviewed.map((r) => [r.reviewerId, r._count._all]));
    const order: Record<string, number> = { OWNER: 0, ADMIN: 1, REVIEWER: 2, TRANSLATOR: 3, VIEWER: 4 };
    return members
      .map((m) => ({ ...m, translated: tMap.get(m.userId) ?? 0, reviewed: rMap.get(m.userId) ?? 0 }))
      .sort((a, b) => order[a.role] - order[b.role]);
  }

  @Patch('projects/:pid/members/:uid')
  async changeRole(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('uid') uid: string, @Body() dto: RoleDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: pid, userId: uid } },
      include: { user: { select: USER_BRIEF } },
    });
    if (!member) throw new NotFoundException('成员不存在');
    if (uid === user.id && !ctx.isSuperAdmin) throw new BadRequestException('不能修改自己的角色');
    this.assertGrant(ctx, member.role as ProjectRole, dto.role);
    const updated = await this.prisma.projectMember.update({
      where: { projectId_userId: { projectId: pid, userId: uid } },
      data: { role: dto.role },
    });
    await this.activity.log(pid, user.id, 'member.role', `将 ${member.user.displayName} 的角色改为${ROLE_LABELS[dto.role]}`);
    return updated;
  }

  @Delete('projects/:pid/members/:uid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('uid') uid: string) {
    const ctx = await this.access.context(user, pid);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: pid, userId: uid } },
      include: { user: { select: USER_BRIEF } },
    });
    if (!member) throw new NotFoundException('成员不存在');
    if (member.role === 'OWNER') throw new BadRequestException('所有者不能退出或被移除，请先转让项目');
    if (uid === user.id) {
      await this.prisma.projectMember.delete({ where: { projectId_userId: { projectId: pid, userId: uid } } });
      await this.activity.log(pid, user.id, 'member.leave', '退出了项目');
      return { ok: true };
    }
    this.access.assert(ctx, PERMISSIONS.MANAGE_MEMBERS);
    this.assertGrant(ctx, member.role as ProjectRole);
    await this.prisma.projectMember.delete({ where: { projectId_userId: { projectId: pid, userId: uid } } });
    await this.activity.log(pid, user.id, 'member.remove', `将 ${member.user.displayName} 移出了项目`);
    return { ok: true };
  }

  // ───────── 加入申请 ─────────

  @Post('projects/:pid/join-requests')
  async requestJoin(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: JoinRequestDto) {
    const ctx = await this.access.context(user, pid);
    if (ctx.role) throw new ConflictException('你已经是该项目成员');
    if (!ctx.isPublic) throw new ForbiddenException('私有项目仅能通过邀请加入');
    const pending = await this.prisma.joinRequest.findFirst({ where: { projectId: pid, userId: user.id, status: 'PENDING' } });
    if (pending) throw new ConflictException('你已提交过申请，请等待管理员审批');
    return this.prisma.joinRequest.create({ data: { projectId: pid, userId: user.id, message: dto.message ?? '' } });
  }

  @Delete('projects/:pid/join-requests/mine')
  async cancelMine(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.prisma.joinRequest.updateMany({
      where: { projectId: pid, userId: user.id, status: 'PENDING' },
      data: { status: 'CANCELED', handledAt: new Date() },
    });
    return { ok: true };
  }

  @Get('projects/:pid/join-requests')
  async listRequests(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Query('status') status = 'PENDING') {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    const valid = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELED'];
    return this.prisma.joinRequest.findMany({
      where: { projectId: pid, ...(valid.includes(status) ? { status: status as 'PENDING' } : {}) },
      include: { user: { select: USER_BRIEF }, handledBy: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Post('projects/:pid/join-requests/:rid/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('rid') rid: string, @Body() dto: ApproveDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    const role = dto.role ?? 'TRANSLATOR';
    this.assertGrant(ctx, 'VIEWER', role);
    const req = await this.prisma.joinRequest.findFirst({
      where: { id: rid, projectId: pid, status: 'PENDING' },
      include: { user: { select: USER_BRIEF } },
    });
    if (!req) throw new NotFoundException('申请不存在或已处理');
    await this.prisma.$transaction([
      this.prisma.joinRequest.update({
        where: { id: rid },
        data: { status: 'APPROVED', handledById: user.id, handledAt: new Date() },
      }),
      this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: pid, userId: req.userId } },
        create: { projectId: pid, userId: req.userId, role },
        update: {},
      }),
    ]);
    await this.activity.log(pid, user.id, 'member.join', `批准 ${req.user.displayName} 以${ROLE_LABELS[role]}身份加入`);
    return { ok: true };
  }

  @Post('projects/:pid/join-requests/:rid/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('rid') rid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    const res = await this.prisma.joinRequest.updateMany({
      where: { id: rid, projectId: pid, status: 'PENDING' },
      data: { status: 'REJECTED', handledById: user.id, handledAt: new Date() },
    });
    if (!res.count) throw new NotFoundException('申请不存在或已处理');
    return { ok: true };
  }

  // ───────── 邀请 ─────────

  @Post('projects/:pid/invitations')
  async invite(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: InviteDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    this.assertGrant(ctx, 'VIEWER', dto.role);
    const login = dto.username.trim();
    const invitee = await this.prisma.user.findFirst({
      where: { OR: [{ username: { equals: login, mode: 'insensitive' } }, { email: login.toLowerCase() }] },
      select: USER_BRIEF,
    });
    if (!invitee) throw new NotFoundException('找不到该用户');
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: pid, userId: invitee.id } },
    });
    if (member) throw new ConflictException('该用户已是项目成员');
    const pending = await this.prisma.invitation.findFirst({
      where: { projectId: pid, inviteeId: invitee.id, status: 'PENDING' },
    });
    if (pending) {
      return this.prisma.invitation.update({ where: { id: pending.id }, data: { role: dto.role, inviterId: user.id } });
    }
    const inv = await this.prisma.invitation.create({
      data: { projectId: pid, inviteeId: invitee.id, inviterId: user.id, role: dto.role },
    });
    await this.activity.log(pid, user.id, 'member.invite', `邀请 ${invitee.displayName} 以${ROLE_LABELS[dto.role]}身份加入`);
    return inv;
  }

  @Get('projects/:pid/invitations')
  async listInvitations(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    return this.prisma.invitation.findMany({
      where: { projectId: pid, status: 'PENDING' },
      include: { invitee: { select: USER_BRIEF }, inviter: { select: USER_BRIEF } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Delete('projects/:pid/invitations/:iid')
  async cancelInvitation(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('iid') iid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_MEMBERS);
    await this.prisma.invitation.updateMany({
      where: { id: iid, projectId: pid, status: 'PENDING' },
      data: { status: 'CANCELED', respondedAt: new Date() },
    });
    return { ok: true };
  }

  @Get('invitations')
  myInvitations(@CurrentUser() user: AuthUser) {
    return this.prisma.invitation.findMany({
      where: { inviteeId: user.id, status: 'PENDING' },
      include: {
        project: { select: { id: true, name: true, engine: true, sourceLang: true, targetLang: true } },
        inviter: { select: USER_BRIEF },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('invitations/:iid/:action')
  async respond(@CurrentUser() user: AuthUser, @Param('iid') iid: string, @Param('action') action: string) {
    if (action !== 'accept' && action !== 'decline') throw new BadRequestException('无效的操作');
    const inv = await this.prisma.invitation.findFirst({ where: { id: iid, inviteeId: user.id, status: 'PENDING' } });
    if (!inv) throw new NotFoundException('邀请不存在或已处理');
    if (action === 'decline') {
      await this.prisma.invitation.update({ where: { id: iid }, data: { status: 'REJECTED', respondedAt: new Date() } });
      return { ok: true };
    }
    await this.prisma.$transaction([
      this.prisma.invitation.update({ where: { id: iid }, data: { status: 'APPROVED', respondedAt: new Date() } }),
      this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: inv.projectId, userId: user.id } },
        create: { projectId: inv.projectId, userId: user.id, role: inv.role },
        update: {},
      }),
      this.prisma.joinRequest.updateMany({
        where: { projectId: inv.projectId, userId: user.id, status: 'PENDING' },
        data: { status: 'APPROVED', handledAt: new Date() },
      }),
    ]);
    await this.activity.log(inv.projectId, user.id, 'member.join', `接受邀请，以${ROLE_LABELS[inv.role]}身份加入`);
    return { ok: true, projectId: inv.projectId };
  }
}
