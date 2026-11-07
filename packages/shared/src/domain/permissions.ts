export const PROJECT_ROLES = ['OWNER', 'ADMIN', 'REVIEWER', 'TRANSLATOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ROLE_LEVEL: Record<ProjectRole, number> = { OWNER: 50, ADMIN: 40, REVIEWER: 30, TRANSLATOR: 20, VIEWER: 10 };

export const PERMISSIONS = {
  VIEW: 'project.view',
  DOWNLOAD_EXPORT: 'export.download',
  /** 翻译未审核词条、标记有疑问、回滚 */
  TRANSLATE: 'entry.translate',
  /** 审核、修改已审核词条、翻译记忆批量填充 */
  REVIEW: 'entry.review',
  MANAGE_TERMS: 'term.manage',
  /** 锁定 / 隐藏、修改已锁定词条 */
  MANAGE_ENTRIES: 'entry.manage',
  MANAGE_FILES: 'file.manage',
  CREATE_EXPORT: 'export.create',
  MANAGE_MEMBERS: 'member.manage',
  MANAGE_PROJECT: 'project.manage',
  /** 删除、转让项目 */
  DELETE_PROJECT: 'project.delete',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;
const VIEWER: Permission[] = [P.VIEW, P.DOWNLOAD_EXPORT];
const TRANSLATOR: Permission[] = [...VIEWER, P.TRANSLATE];
const REVIEWER: Permission[] = [...TRANSLATOR, P.REVIEW, P.MANAGE_TERMS];
const ADMIN: Permission[] = [...REVIEWER, P.MANAGE_ENTRIES, P.MANAGE_FILES, P.CREATE_EXPORT, P.MANAGE_MEMBERS, P.MANAGE_PROJECT];

export const ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  OWNER: [...ADMIN, P.DELETE_PROJECT],
  ADMIN,
  REVIEWER,
  TRANSLATOR,
  VIEWER,
};

/** 非成员浏览公开项目时的权限 */
export const PUBLIC_PERMISSIONS: Permission[] = [P.VIEW];

export function roleHas(role: ProjectRole | null | undefined, perm: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(perm);
}

export function can(ctx: { role: ProjectRole | null; isSuperAdmin?: boolean; isPublic?: boolean }, perm: Permission): boolean {
  if (ctx.isSuperAdmin) return true;
  if (ctx.role) return roleHas(ctx.role, perm);
  return !!ctx.isPublic && PUBLIC_PERMISSIONS.includes(perm);
}

/** 管理员只能管理、授予比自己低的角色；所有者只能通过转让变更 */
export function canManageMember(actor: ProjectRole | null, isSuperAdmin: boolean, target: ProjectRole, newRole?: ProjectRole): boolean {
  if (newRole === 'OWNER' || target === 'OWNER') return false;
  if (isSuperAdmin || actor === 'OWNER') return true;
  if (actor !== 'ADMIN') return false;
  if (ROLE_LEVEL[target] >= ROLE_LEVEL.ADMIN) return false;
  return !newRole || ROLE_LEVEL[newRole] < ROLE_LEVEL.ADMIN;
}
