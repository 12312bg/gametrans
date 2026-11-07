import { Injectable } from '@nestjs/common';
import { PERMISSIONS, ProjectRole, canManageMember } from '@gametrans/shared';
import { AccessService, ProjectContext } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import type { AuthUser } from '../common/decorators';
import { fail } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const USER_BRIEF = { select: { id: true, username: true, displayName: true } } as const;
const ROLE_ORDER: Record<string, number> = { OWNER: 0, ADMIN: 1, REVIEWER: 2, TRANSLATOR: 3, VIEWER: 4 };
const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELED'] as const;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  private assertGrant(ctx: ProjectContext, target: ProjectRole, newRole?: ProjectRole) {
    if (!canManageMember(ctx.role, ctx.isSuperAdmin, target, newRole)) throw fail('MEMBER_MANAGE_DENIED');
  }

  private async member(pid: string, uid: string) {
    const m = await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: uid } }, include: { user: USER_BRIEF } });
    if (!m) throw fail('MEMBER_NOT_FOUND');
    return m;
  }

  async list(pid: string) {
    const [members, translated, reviewed] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId: pid }, include: { user: USER_BRIEF }, orderBy: { joinedAt: 'asc' } }),
      this.prisma.entry.groupBy({ by: ['translatorId'], where: { projectId: pid, translation: { not: '' } }, _count: { _all: true } }),
      this.prisma.entry.groupBy({ by: ['reviewerId'], where: { projectId: pid, stage: { in: ['REVIEWED', 'LOCKED'] } }, _count: { _all: true } }),
    ]);
    const tMap = new Map(translated.map((t) => [t.translatorId, t._count._all]));
    const rMap = new Map(reviewed.map((r) => [r.reviewerId, r._count._all]));
    return members
      .map((m) => ({ ...m, translated: tMap.get(m.userId) ?? 0, reviewed: rMap.get(m.userId) ?? 0 }))
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  }

  async changeRole(ctx: ProjectContext, uid: string, role: ProjectRole) {
    const pid = ctx.project.id;
    const m = await this.member(pid, uid);
    if (uid === ctx.user?.id && !ctx.isSuperAdmin) throw fail('CANNOT_CHANGE_OWN_ROLE');
    this.assertGrant(ctx, m.role as ProjectRole, role);
    const updated = await this.prisma.projectMember.update({ where: { projectId_userId: { projectId: pid, userId: uid } }, data: { role } });
    await this.activity.log(pid, ctx.user?.id, 'member.role', { name: m.user.displayName, role });
    return updated;
  }

  /** uid 为自己时表示退出项目 */
  async remove(ctx: ProjectContext, uid: string) {
    const pid = ctx.project.id;
    const m = await this.member(pid, uid);
    if (m.role === 'OWNER') throw fail('OWNER_CANNOT_LEAVE');
    const self = uid === ctx.user?.id;
    if (!self) {
      this.access.assert(ctx, PERMISSIONS.MANAGE_MEMBERS);
      this.assertGrant(ctx, m.role as ProjectRole);
    }
    await this.prisma.projectMember.delete({ where: { projectId_userId: { projectId: pid, userId: uid } } });
    await this.activity.log(pid, ctx.user?.id, self ? 'member.leave' : 'member.remove', self ? {} : { name: m.user.displayName });
  }

  async requestJoin(ctx: ProjectContext, user: AuthUser, message = '') {
    const pid = ctx.project.id;
    if (ctx.role) throw fail('ALREADY_MEMBER');
    if (!ctx.isPublic) throw fail('PRIVATE_PROJECT_INVITE_ONLY');
    if (await this.prisma.joinRequest.findFirst({ where: { projectId: pid, userId: user.id, status: 'PENDING' } })) throw fail('JOIN_REQUEST_PENDING');
    return this.prisma.joinRequest.create({ data: { projectId: pid, userId: user.id, message } });
  }

  cancelMine(pid: string, userId: string) {
    return this.prisma.joinRequest.updateMany({
      where: { projectId: pid, userId, status: 'PENDING' },
      data: { status: 'CANCELED', handledAt: new Date() },
    });
  }

  listRequests(pid: string, status: string) {
    const valid = (REQUEST_STATUSES as readonly string[]).includes(status);
    return this.prisma.joinRequest.findMany({
      where: { projectId: pid, ...(valid ? { status: status as (typeof REQUEST_STATUSES)[number] } : {}) },
      include: { user: USER_BRIEF, handledBy: USER_BRIEF },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async approve(ctx: ProjectContext, rid: string, role: ProjectRole = 'TRANSLATOR') {
    const pid = ctx.project.id;
    this.assertGrant(ctx, 'VIEWER', role);
    const req = await this.prisma.joinRequest.findFirst({ where: { id: rid, projectId: pid, status: 'PENDING' }, include: { user: USER_BRIEF } });
    if (!req) throw fail('JOIN_REQUEST_NOT_FOUND');
    await this.prisma.$transaction([
      this.prisma.joinRequest.update({ where: { id: rid }, data: { status: 'APPROVED', handledById: ctx.user!.id, handledAt: new Date() } }),
      this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: pid, userId: req.userId } },
        create: { projectId: pid, userId: req.userId, role },
        update: {},
      }),
    ]);
    await this.activity.log(pid, ctx.user?.id, 'member.join', { name: req.user.displayName, role });
  }

  async reject(ctx: ProjectContext, rid: string) {
    const res = await this.prisma.joinRequest.updateMany({
      where: { id: rid, projectId: ctx.project.id, status: 'PENDING' },
      data: { status: 'REJECTED', handledById: ctx.user!.id, handledAt: new Date() },
    });
    if (!res.count) throw fail('JOIN_REQUEST_NOT_FOUND');
  }

  async invite(ctx: ProjectContext, login: string, role: ProjectRole) {
    const pid = ctx.project.id;
    this.assertGrant(ctx, 'VIEWER', role);
    const name = login.trim();
    const invitee = await this.prisma.user.findFirst({
      where: { OR: [{ username: { equals: name, mode: 'insensitive' } }, { email: name.toLowerCase() }] },
      ...USER_BRIEF,
    });
    if (!invitee) throw fail('USER_NOT_FOUND');
    if (await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: invitee.id } } })) throw fail('USER_ALREADY_MEMBER');
    const pending = await this.prisma.invitation.findFirst({ where: { projectId: pid, inviteeId: invitee.id, status: 'PENDING' } });
    if (pending) return this.prisma.invitation.update({ where: { id: pending.id }, data: { role, inviterId: ctx.user!.id } });
    const inv = await this.prisma.invitation.create({ data: { projectId: pid, inviteeId: invitee.id, inviterId: ctx.user!.id, role } });
    await this.activity.log(pid, ctx.user?.id, 'member.invite', { name: invitee.displayName, role });
    return inv;
  }

  listInvitations(pid: string) {
    return this.prisma.invitation.findMany({
      where: { projectId: pid, status: 'PENDING' },
      include: { invitee: USER_BRIEF, inviter: USER_BRIEF },
      orderBy: { createdAt: 'desc' },
    });
  }

  cancelInvitation(pid: string, iid: string) {
    return this.prisma.invitation.updateMany({
      where: { id: iid, projectId: pid, status: 'PENDING' },
      data: { status: 'CANCELED', respondedAt: new Date() },
    });
  }

  myInvitations(userId: string) {
    return this.prisma.invitation.findMany({
      where: { inviteeId: userId, status: 'PENDING' },
      include: { project: { select: { id: true, name: true, engine: true, sourceLang: true, targetLang: true } }, inviter: USER_BRIEF },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respond(user: AuthUser, iid: string, action: string) {
    if (action !== 'accept' && action !== 'decline') throw fail('INVALID_ACTION');
    const inv = await this.prisma.invitation.findFirst({ where: { id: iid, inviteeId: user.id, status: 'PENDING' } });
    if (!inv) throw fail('INVITATION_NOT_FOUND');
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
    await this.activity.log(inv.projectId, user.id, 'member.accept', { role: inv.role });
    return { ok: true, projectId: inv.projectId };
  }
}
