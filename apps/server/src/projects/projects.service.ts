import { Injectable } from '@nestjs/common';
import { ENGINES, Engine, PERMISSIONS, can, formatActivity } from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import { AccessService, ProjectContext } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import type { AuthUser } from '../common/decorators';
import { fail } from '../common/errors';
import type { Translator } from '../common/locale';
import { escapeLike, pageParams } from '../common/query';
import { emptyCounts, stageCounts } from '../common/stats';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';

const USER_BRIEF = { select: { id: true, username: true, displayName: true } } as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
  ) {}

  async list(user: AuthUser | undefined, q: { scope?: string; q?: string; engine?: string; page?: string; pageSize?: string }) {
    const { skip, take, ...p } = pageParams(q.page, q.pageSize, 100);
    const and: Prisma.ProjectWhereInput[] = [];
    if (q.scope === 'mine') {
      if (!user) return { items: [], total: 0, ...p };
      and.push({ members: { some: { userId: user.id } } });
    } else if (q.scope === 'all') {
      if (!user?.isSuperAdmin) throw fail('SUPERADMIN_ONLY');
    } else {
      and.push({ visibility: 'PUBLIC' });
    }
    const like = escapeLike(q.q?.trim() ?? '');
    if (like) and.push({ OR: [{ name: { contains: like, mode: 'insensitive' } }, { description: { contains: like, mode: 'insensitive' } }] });
    if (q.engine && (ENGINES as readonly string[]).includes(q.engine)) and.push({ engine: q.engine as Engine });

    const where: Prisma.ProjectWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          owner: USER_BRIEF,
          _count: { select: { members: true, files: true } },
          members: user ? { where: { userId: user.id }, select: { role: true } } : false,
        },
      }),
      this.prisma.project.count({ where }),
    ]);
    const counts = await stageCounts(this.prisma, 'projectId', { projectId: { in: rows.map((r) => r.id) } });
    const items = rows.map(({ members, ...r }) => ({
      ...r,
      myRole: (members as { role: string }[] | undefined)?.[0]?.role ?? null,
      stats: counts.get(r.id) ?? emptyCounts(),
    }));
    return { items, total, ...p };
  }

  async create(user: AuthUser, dto: CreateProjectDto) {
    if (config.projectCreation === 'superadmin' && !user.isSuperAdmin) throw fail('PROJECT_CREATION_RESTRICTED');
    if (dto.sourceLang === dto.targetLang) throw fail('SAME_LANGUAGE');
    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        description: dto.description ?? '',
        engine: dto.engine,
        sourceLang: dto.sourceLang,
        targetLang: dto.targetLang,
        visibility: dto.visibility,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    await this.activity.log(project.id, user.id, 'project.create', { name: project.name });
    return project;
  }

  async detail(ctx: ProjectContext) {
    const pid = ctx.project.id;
    const user = ctx.user;
    const [owner, counts, memberCount, fileCount, pendingRequests, myJoinRequest] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: ctx.project.ownerId }, ...USER_BRIEF }),
      stageCounts(this.prisma, 'projectId', { projectId: pid }),
      this.prisma.projectMember.count({ where: { projectId: pid } }),
      this.prisma.file.count({ where: { projectId: pid } }),
      can(ctx, PERMISSIONS.MANAGE_MEMBERS) ? this.prisma.joinRequest.count({ where: { projectId: pid, status: 'PENDING' } }) : 0,
      user && !ctx.role ? this.prisma.joinRequest.findFirst({ where: { projectId: pid, userId: user.id, status: 'PENDING' } }) : null,
    ]);
    return {
      ...ctx.project,
      owner,
      myRole: ctx.role,
      permissions: this.access.permissions(ctx),
      stats: counts.get(pid) ?? emptyCounts(),
      memberCount,
      fileCount,
      pendingRequests,
      myJoinRequest,
    };
  }

  async update(ctx: ProjectContext, dto: UpdateProjectDto) {
    const { project } = ctx;
    if ((dto.sourceLang ?? project.sourceLang) === (dto.targetLang ?? project.targetLang)) throw fail('SAME_LANGUAGE');
    const updated = await this.prisma.project.update({ where: { id: project.id }, data: dto });
    await this.activity.log(project.id, ctx.user?.id, 'project.update');
    return updated;
  }

  async remove(pid: string) {
    await this.prisma.project.delete({ where: { id: pid } });
    await this.storage.remove(`projects/${pid}`);
  }

  async transfer(ctx: ProjectContext, userId: string) {
    const pid = ctx.project.id;
    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: pid, userId } },
      include: { user: { select: { displayName: true } } },
    });
    if (!target) throw fail('TRANSFER_NOT_MEMBER');
    if (target.role === 'OWNER') throw fail('ALREADY_OWNER');
    await this.prisma.$transaction([
      this.prisma.projectMember.updateMany({ where: { projectId: pid, role: 'OWNER' }, data: { role: 'ADMIN' } }),
      this.prisma.projectMember.update({ where: { projectId_userId: { projectId: pid, userId } }, data: { role: 'OWNER' } }),
      this.prisma.project.update({ where: { id: pid }, data: { ownerId: userId } }),
    ]);
    await this.activity.log(pid, ctx.user?.id, 'project.transfer', { name: target.user.displayName });
  }

  async stats(pid: string) {
    const [byStage, byCategory, translators, reviewers] = await Promise.all([
      stageCounts(this.prisma, 'projectId', { projectId: pid }),
      this.prisma.entry.groupBy({ by: ['category'], where: { projectId: pid, stage: { not: 'HIDDEN' } }, _count: { _all: true } }),
      this.prisma.entry.groupBy({
        by: ['translatorId'],
        where: { projectId: pid, translatorId: { not: null }, translation: { not: '' } },
        _count: { _all: true },
        orderBy: { _count: { translatorId: 'desc' } },
        take: 20,
      }),
      this.prisma.entry.groupBy({
        by: ['reviewerId'],
        where: { projectId: pid, reviewerId: { not: null }, stage: { in: ['REVIEWED', 'LOCKED'] } },
        _count: { _all: true },
        orderBy: { _count: { reviewerId: 'desc' } },
        take: 20,
      }),
    ]);
    const ids = [...translators.map((t) => t.translatorId!), ...reviewers.map((r) => r.reviewerId!)];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, ...USER_BRIEF });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      byStage: byStage.get(pid) ?? emptyCounts(),
      byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])),
      translators: translators.map((t) => ({ user: byId.get(t.translatorId!), count: t._count._all })),
      reviewers: reviewers.map((r) => ({ user: byId.get(r.reviewerId!), count: r._count._all })),
    };
  }

  /** message 按请求语言渲染；params 供客户端自行渲染 */
  async activities(pid: string, t: Translator, page?: string, pageSize?: string) {
    const { skip, take, ...p } = pageParams(page, pageSize, 100);
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where: { projectId: pid }, skip, take, orderBy: { createdAt: 'desc' }, include: { user: USER_BRIEF } }),
      this.prisma.activity.count({ where: { projectId: pid } }),
    ]);
    const items = rows.map((a) => ({ ...a, message: formatActivity({ ...a, params: a.params as Record<string, string> | null }, t) }));
    return { items, total, ...p };
  }
}
