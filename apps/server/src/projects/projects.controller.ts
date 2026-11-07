import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ENGINES, Engine, LANGUAGES, PERMISSIONS, ROLE_PERMISSIONS, STAGES, Stage, can } from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { escapeLike, pageParams } from '../common/pagination';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectModel, ProjectDetailModel } from '../common/api.models';

const LANG_CODES = LANGUAGES.map((l) => l.code);

class CreateProjectDto {
  @IsString() @Length(1, 80, { message: '项目名称为 1-80 个字符' }) name: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsIn(ENGINES as unknown as string[], { message: '不支持的引擎' }) engine: Engine;
  @IsIn(LANG_CODES, { message: '不支持的源语言' }) sourceLang: string;
  @IsIn(LANG_CODES, { message: '不支持的目标语言' }) targetLang: string;
  @IsIn(['PUBLIC', 'PRIVATE']) visibility: 'PUBLIC' | 'PRIVATE';
}

class UpdateProjectDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsOptional() @IsIn(LANG_CODES) sourceLang?: string;
  @IsOptional() @IsIn(LANG_CODES) targetLang?: string;
  @IsOptional() @IsIn(['PUBLIC', 'PRIVATE']) visibility?: 'PUBLIC' | 'PRIVATE';
}

class TransferDto {
  @IsString() userId: string;
}

export type StageCounts = Record<Stage, number>;

export function emptyCounts(): StageCounts {
  return Object.fromEntries(STAGES.map((s) => [s, 0])) as StageCounts;
}

@ApiTags('项目')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
  ) {}

  /** 各项目按状态统计的词条数 */
  private async stageCounts(projectIds: string[]): Promise<Map<string, StageCounts>> {
    const map = new Map<string, StageCounts>();
    if (!projectIds.length) return map;
    const rows = await this.prisma.entry.groupBy({
      by: ['projectId', 'stage'],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    });
    for (const r of rows) {
      const c = map.get(r.projectId) ?? emptyCounts();
      c[r.stage as Stage] = r._count._all;
      map.set(r.projectId, c);
    }
    return map;
  }

  @ApiOperation({ summary: '项目列表', description: 'scope=public 公开项目（无需登录）；mine 我参与的；all 全部（仅超级管理员）。' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数' })
  @ApiQuery({ name: 'page', required: false, description: '页码，从 1 开始' })
  @ApiQuery({ name: 'engine', required: false, description: '按引擎筛选', enum: ['RMXP', 'RMVX', 'RMVXACE', 'RMMV', 'RMMZ'] })
  @ApiQuery({ name: 'q', required: false, description: '按名称 / 简介搜索' })
  @ApiQuery({ name: 'scope', required: false, description: '范围', enum: ['public', 'mine', 'all'] })
  @Public()
  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('scope') scope = 'public',
    @Query('q') q = '',
    @Query('engine') engine?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const { skip, take, ...p } = pageParams(page, pageSize, 100);
    const and: Prisma.ProjectWhereInput[] = [];
    if (scope === 'mine') {
      if (!user) return { items: [], total: 0, ...p };
      and.push({ members: { some: { userId: user.id } } });
    } else if (scope === 'all') {
      if (!user?.isSuperAdmin) throw new ForbiddenException('仅超级管理员可查看全部项目');
    } else {
      and.push({ visibility: 'PUBLIC' });
    }
    if (q.trim()) {
      const like = escapeLike(q.trim());
      and.push({
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { description: { contains: like, mode: 'insensitive' } },
        ],
      });
    }
    if (engine && (ENGINES as readonly string[]).includes(engine)) and.push({ engine: engine as Engine });
    const where: Prisma.ProjectWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          owner: { select: { id: true, username: true, displayName: true } },
          _count: { select: { members: true, files: true } },
          members: user ? { where: { userId: user.id }, select: { role: true } } : false,
        },
      }),
      this.prisma.project.count({ where }),
    ]);
    const counts = await this.stageCounts(rows.map((r) => r.id));
    const items = rows.map(({ members, ...r }) => ({
      ...r,
      myRole: (members as { role: string }[] | undefined)?.[0]?.role ?? null,
      stats: counts.get(r.id) ?? emptyCounts(),
    }));
    return { items, total, ...p };
  }

  @ApiOperation({ summary: '创建项目', description: '创建者成为所有者。' })
  @ApiCreatedResponse({ type: ProjectModel })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    if (config.projectCreation === 'superadmin' && !user.isSuperAdmin) {
      throw new ForbiddenException('本站仅允许超级管理员创建项目');
    }
    if (dto.sourceLang === dto.targetLang) throw new BadRequestException('源语言与目标语言不能相同');
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
    await this.activity.log(project.id, user.id, 'project.create', `创建了项目「${project.name}」`);
    return project;
  }

  @ApiOperation({ summary: '项目详情', description: '包含当前用户的角色、权限点与词条统计。公开项目无需登录。' })
  @ApiOkResponse({ type: ProjectDetailModel })
  @Public()
  @Get(':pid')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    const ctx = await this.access.context(user, pid);
    const [owner, counts, memberCount, fileCount, pendingRequests, myRequest] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: ctx.project.ownerId }, select: { id: true, username: true, displayName: true } }),
      this.stageCounts([pid]),
      this.prisma.projectMember.count({ where: { projectId: pid } }),
      this.prisma.file.count({ where: { projectId: pid } }),
      can(ctx, PERMISSIONS.MANAGE_MEMBERS)
        ? this.prisma.joinRequest.count({ where: { projectId: pid, status: 'PENDING' } })
        : Promise.resolve(0),
      user && !ctx.role
        ? this.prisma.joinRequest.findFirst({ where: { projectId: pid, userId: user.id, status: 'PENDING' } })
        : Promise.resolve(null),
    ]);
    const permissions = ctx.isSuperAdmin
      ? Object.values(PERMISSIONS)
      : ctx.role
        ? ROLE_PERMISSIONS[ctx.role]
        : ctx.isPublic
          ? [PERMISSIONS.VIEW]
          : [];
    return {
      ...ctx.project,
      owner,
      myRole: ctx.role,
      permissions,
      stats: counts.get(pid) ?? emptyCounts(),
      memberCount,
      fileCount,
      pendingRequests,
      myJoinRequest: myRequest,
    };
  }

  @ApiOperation({ summary: '修改项目设置', description: '需要管理员及以上。' })
  @ApiOkResponse({ type: ProjectModel })
  @Patch(':pid')
  async update(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: UpdateProjectDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT);
    const src = dto.sourceLang ?? ctx.project.sourceLang;
    const tgt = dto.targetLang ?? ctx.project.targetLang;
    if (src === tgt) throw new BadRequestException('源语言与目标语言不能相同');
    const project = await this.prisma.project.update({ where: { id: pid }, data: dto });
    await this.activity.log(pid, user.id, 'project.update', '修改了项目设置');
    return project;
  }

  @ApiOperation({ summary: '删除项目', description: '仅所有者。删除全部文件、词条与历史，无法恢复。' })
  @Delete(':pid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.DELETE_PROJECT);
    await this.prisma.project.delete({ where: { id: pid } });
    await this.storage.remove(`projects/${pid}`);
    return { ok: true };
  }

  @ApiOperation({ summary: '转让项目', description: '仅所有者。原所有者变为管理员。' })
  @Post(':pid/transfer')
  async transfer(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: TransferDto) {
    await this.access.require(user, pid, PERMISSIONS.DELETE_PROJECT);
    const target = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: pid, userId: dto.userId } },
      include: { user: { select: { displayName: true } } },
    });
    if (!target) throw new BadRequestException('只能转让给项目成员');
    if (target.role === 'OWNER') throw new BadRequestException('该成员已是所有者');
    await this.prisma.$transaction([
      this.prisma.projectMember.updateMany({ where: { projectId: pid, role: 'OWNER' }, data: { role: 'ADMIN' } }),
      this.prisma.projectMember.update({
        where: { projectId_userId: { projectId: pid, userId: dto.userId } },
        data: { role: 'OWNER' },
      }),
      this.prisma.project.update({ where: { id: pid }, data: { ownerId: dto.userId } }),
    ]);
    await this.activity.log(pid, user.id, 'project.transfer', `将项目转让给 ${target.user.displayName}`);
    return { ok: true };
  }

  @ApiOperation({ summary: '项目统计', description: '按状态、分类统计，以及翻译 / 审核贡献榜。' })
  @Public()
  @Get(':pid/stats')
  async stats(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const [byStage, byCategory, translators, reviewers] = await Promise.all([
      this.stageCounts([pid]),
      this.prisma.entry.groupBy({
        by: ['category'],
        where: { projectId: pid, stage: { not: 'HIDDEN' } },
        _count: { _all: true },
      }),
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
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, displayName: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      byStage: byStage.get(pid) ?? emptyCounts(),
      byCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])),
      translators: translators.map((t) => ({ user: byId.get(t.translatorId!), count: t._count._all })),
      reviewers: reviewers.map((r) => ({ user: byId.get(r.reviewerId!), count: r._count._all })),
    };
  }

  @ApiOperation({ summary: '项目动态' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数' })
  @ApiQuery({ name: 'page', required: false, description: '页码，从 1 开始' })
  @Public()
  @Get(':pid/activity')
  async activityList(
    @CurrentUser() user: AuthUser | undefined,
    @Param('pid') pid: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const { skip, take, ...p } = pageParams(page, pageSize, 100);
    const [items, total] = await Promise.all([
      this.prisma.activity.findMany({
        where: { projectId: pid },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, username: true, displayName: true } } },
      }),
      this.prisma.activity.count({ where: { projectId: pid } }),
    ]);
    return { items, total, ...p };
  }
}
