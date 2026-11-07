import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PERMISSIONS, Permission, ProjectRole, can } from '@gametrans/shared';
import type { Project } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './decorators';

export interface ProjectContext {
  project: Project;
  role: ProjectRole | null;
  isSuperAdmin: boolean;
  isPublic: boolean;
  user?: AuthUser;
}

/** 统一的项目级鉴权：解析当前用户在项目中的角色，并校验权限 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async context(user: AuthUser | undefined, projectId: string): Promise<ProjectContext> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    let role: ProjectRole | null = null;
    if (user) {
      const m = await this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: user.id } },
      });
      role = (m?.role as ProjectRole) ?? null;
    }
    const ctx: ProjectContext = {
      project,
      role,
      isSuperAdmin: !!user?.isSuperAdmin,
      isPublic: project.visibility === 'PUBLIC',
      user,
    };
    // 私有项目对无权限者表现为不存在
    if (!can(ctx, PERMISSIONS.VIEW)) throw new NotFoundException('项目不存在');
    return ctx;
  }

  async require(user: AuthUser | undefined, projectId: string, perm: Permission): Promise<ProjectContext> {
    const ctx = await this.context(user, projectId);
    this.assert(ctx, perm);
    return ctx;
  }

  assert(ctx: ProjectContext, perm: Permission): void {
    if (can(ctx, perm)) return;
    if (!ctx.user) throw new UnauthorizedException('请先登录');
    throw new ForbiddenException('没有权限执行此操作');
  }

  has(ctx: ProjectContext, perm: Permission): boolean {
    return can(ctx, perm);
  }
}
