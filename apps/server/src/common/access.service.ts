import { Injectable } from '@nestjs/common';
import { PERMISSIONS, Permission, ProjectRole, ROLE_PERMISSIONS, can } from '@gametrans/shared';
import type { Project } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './decorators';
import { fail } from './errors';

export interface ProjectContext {
  project: Project;
  role: ProjectRole | null;
  isSuperAdmin: boolean;
  isPublic: boolean;
  user?: AuthUser;
}

/** 项目级鉴权：解析当前用户在项目中的角色并校验权限 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async context(user: AuthUser | undefined, projectId: string): Promise<ProjectContext> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw fail('PROJECT_NOT_FOUND');
    const member = user
      ? await this.prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: user.id } } })
      : null;
    const ctx: ProjectContext = {
      project,
      role: (member?.role as ProjectRole) ?? null,
      isSuperAdmin: !!user?.isSuperAdmin,
      isPublic: project.visibility === 'PUBLIC',
      user,
    };
    // 私有项目对无权限者表现为不存在
    if (!can(ctx, PERMISSIONS.VIEW)) throw fail('PROJECT_NOT_FOUND');
    return ctx;
  }

  async require(user: AuthUser | undefined, projectId: string, perm: Permission): Promise<ProjectContext> {
    const ctx = await this.context(user, projectId);
    this.assert(ctx, perm);
    return ctx;
  }

  assert(ctx: ProjectContext, perm: Permission): void {
    if (can(ctx, perm)) return;
    throw fail(ctx.user ? 'FORBIDDEN' : 'AUTH_REQUIRED');
  }

  permissions(ctx: ProjectContext): Permission[] {
    if (ctx.isSuperAdmin) return Object.values(PERMISSIONS);
    if (ctx.role) return ROLE_PERMISSIONS[ctx.role];
    return ctx.isPublic ? [PERMISSIONS.VIEW] : [];
  }
}
