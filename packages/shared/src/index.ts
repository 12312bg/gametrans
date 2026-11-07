/**
 * 前后端共享的枚举、权限矩阵与工具函数。
 * 权限规则集中定义在此文件，前端据此隐藏按钮，后端据此做鉴权。
 */

// ───────────────────────── 引擎 ─────────────────────────

export const ENGINES = ['RMXP', 'RMVX', 'RMVXACE', 'RMMV', 'RMMZ'] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_LABELS: Record<Engine, string> = {
  RMXP: 'RPG Maker XP',
  RMVX: 'RPG Maker VX',
  RMVXACE: 'RPG Maker VX Ace',
  RMMV: 'RPG Maker MV',
  RMMZ: 'RPG Maker MZ',
};

/** 各引擎可上传的数据文件扩展名 */
export const ENGINE_EXTENSIONS: Record<Engine, string[]> = {
  RMXP: ['.rxdata'],
  RMVX: ['.rvdata'],
  RMVXACE: ['.rvdata2'],
  RMMV: ['.json', '.js'],
  RMMZ: ['.json', '.js'],
};

export function isRgssEngine(engine: Engine): boolean {
  return engine === 'RMXP' || engine === 'RMVX' || engine === 'RMVXACE';
}

// ───────────────────────── 角色 ─────────────────────────

export const PROJECT_ROLES = ['OWNER', 'ADMIN', 'REVIEWER', 'TRANSLATOR', 'VIEWER'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ROLE_LABELS: Record<ProjectRole, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  REVIEWER: '审核员',
  TRANSLATOR: '翻译员',
  VIEWER: '访客',
};

export const ROLE_LEVEL: Record<ProjectRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  REVIEWER: 30,
  TRANSLATOR: 20,
  VIEWER: 10,
};

// ───────────────────────── 权限 ─────────────────────────

export const PERMISSIONS = {
  /** 浏览项目、文件、词条、术语表、统计 */
  VIEW: 'project.view',
  /** 下载导出包 */
  DOWNLOAD_EXPORT: 'export.download',
  /** 翻译未审核的词条、标记有疑问、回滚自己可编辑的词条 */
  TRANSLATE: 'entry.translate',
  /** 审核/取消审核、修改已审核词条、翻译记忆批量填充 */
  REVIEW: 'entry.review',
  /** 管理术语表 */
  MANAGE_TERMS: 'term.manage',
  /** 锁定/解锁、隐藏/取消隐藏、修改已锁定词条 */
  MANAGE_ENTRIES: 'entry.manage',
  /** 上传、更新、删除文件，下载原始文件 */
  MANAGE_FILES: 'file.manage',
  /** 创建导出 */
  CREATE_EXPORT: 'export.create',
  /** 审批加入申请、邀请成员、调整角色、移除成员 */
  MANAGE_MEMBERS: 'member.manage',
  /** 修改项目设置 */
  MANAGE_PROJECT: 'project.manage',
  /** 删除、转让项目 */
  DELETE_PROJECT: 'project.delete',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;
const VIEWER_PERMS: Permission[] = [P.VIEW, P.DOWNLOAD_EXPORT];
const TRANSLATOR_PERMS: Permission[] = [...VIEWER_PERMS, P.TRANSLATE];
const REVIEWER_PERMS: Permission[] = [...TRANSLATOR_PERMS, P.REVIEW, P.MANAGE_TERMS];
const ADMIN_PERMS: Permission[] = [
  ...REVIEWER_PERMS,
  P.MANAGE_ENTRIES,
  P.MANAGE_FILES,
  P.CREATE_EXPORT,
  P.MANAGE_MEMBERS,
  P.MANAGE_PROJECT,
];
const OWNER_PERMS: Permission[] = [...ADMIN_PERMS, P.DELETE_PROJECT];

export const ROLE_PERMISSIONS: Record<ProjectRole, Permission[]> = {
  OWNER: OWNER_PERMS,
  ADMIN: ADMIN_PERMS,
  REVIEWER: REVIEWER_PERMS,
  TRANSLATOR: TRANSLATOR_PERMS,
  VIEWER: VIEWER_PERMS,
};

/** 非成员浏览公开项目时拥有的权限 */
export const PUBLIC_PERMISSIONS: Permission[] = [P.VIEW];

export function roleHas(role: ProjectRole | null | undefined, perm: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(perm);
}

/** 当前用户可执行某权限（超级管理员拥有全部权限） */
export function can(
  ctx: { role: ProjectRole | null; isSuperAdmin?: boolean; isPublic?: boolean },
  perm: Permission,
): boolean {
  if (ctx.isSuperAdmin) return true;
  if (ctx.role) return roleHas(ctx.role, perm);
  return !!ctx.isPublic && PUBLIC_PERMISSIONS.includes(perm);
}

/** 操作者能否把成员 target 设置为 newRole / 移除 target */
export function canManageMember(
  actor: ProjectRole | null,
  isSuperAdmin: boolean,
  target: ProjectRole,
  newRole?: ProjectRole,
): boolean {
  if (newRole === 'OWNER' || target === 'OWNER') return false; // 所有者只能通过转让变更
  if (isSuperAdmin || actor === 'OWNER') return true;
  if (actor !== 'ADMIN') return false;
  // 管理员只能管理比自己低的角色，且只能授予比自己低的角色
  if (ROLE_LEVEL[target] >= ROLE_LEVEL.ADMIN) return false;
  if (newRole && ROLE_LEVEL[newRole] >= ROLE_LEVEL.ADMIN) return false;
  return true;
}

// ───────────────────────── 词条状态 ─────────────────────────

export const STAGES = ['UNTRANSLATED', 'TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED', 'HIDDEN'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  UNTRANSLATED: '未翻译',
  TRANSLATED: '已翻译',
  QUESTIONED: '有疑问',
  REVIEWED: '已审核',
  LOCKED: '已锁定',
  HIDDEN: '已隐藏',
};

export const STAGE_COLORS: Record<Stage, string> = {
  UNTRANSLATED: 'default',
  TRANSLATED: 'processing',
  QUESTIONED: 'warning',
  REVIEWED: 'success',
  LOCKED: 'purple',
  HIDDEN: 'default',
};

/** 编辑某状态词条译文所需的权限 */
export function permissionToEdit(stage: Stage): Permission {
  switch (stage) {
    case 'UNTRANSLATED':
    case 'TRANSLATED':
    case 'QUESTIONED':
      return P.TRANSLATE;
    case 'REVIEWED':
      return P.REVIEW;
    case 'LOCKED':
    case 'HIDDEN':
      return P.MANAGE_ENTRIES;
  }
}

/** 把词条从 from 状态改为 to 状态所需的权限（不改状态返回 null） */
export function permissionForTransition(from: Stage, to: Stage): Permission | null {
  if (from === to) return null;
  if (to === 'LOCKED' || to === 'HIDDEN' || from === 'LOCKED' || from === 'HIDDEN') return P.MANAGE_ENTRIES;
  if (to === 'REVIEWED' || from === 'REVIEWED') return P.REVIEW;
  return P.TRANSLATE;
}

/** 批量操作 */
export const BATCH_ACTIONS = ['review', 'unreview', 'lock', 'unlock', 'hide', 'unhide', 'question', 'clear'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

export const BATCH_ACTION_LABELS: Record<BatchAction, string> = {
  review: '审核通过',
  unreview: '取消审核',
  lock: '锁定',
  unlock: '解锁',
  hide: '隐藏',
  unhide: '取消隐藏',
  question: '标记有疑问',
  clear: '清空译文',
};

export const BATCH_ACTION_PERMISSION: Record<BatchAction, Permission> = {
  review: P.REVIEW,
  unreview: P.REVIEW,
  question: P.REVIEW,
  lock: P.MANAGE_ENTRIES,
  unlock: P.MANAGE_ENTRIES,
  hide: P.MANAGE_ENTRIES,
  unhide: P.MANAGE_ENTRIES,
  clear: P.MANAGE_ENTRIES,
};

// ───────────────────────── 词条分类 ─────────────────────────

export const ENTRY_CATEGORIES = [
  'dialogue',
  'choice',
  'scroll',
  'speaker',
  'name',
  'nickname',
  'description',
  'message',
  'system',
  'map',
  'note',
  'script',
  'plugin',
  'other',
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EntryCategory, string> = {
  dialogue: '对话',
  choice: '选项',
  scroll: '滚动文字',
  speaker: '说话人',
  name: '名称',
  nickname: '称号',
  description: '说明',
  message: '战斗/状态信息',
  system: '系统用语',
  map: '地图名',
  note: '备注(Note)',
  script: '脚本',
  plugin: '插件',
  other: '其他',
};

/** 默认隐藏（危险）的分类 */
export const DANGER_CATEGORIES: EntryCategory[] = ['note', 'script', 'plugin'];

// ───────────────────────── 其他 ─────────────────────────

export const HISTORY_ACTIONS = [
  'TRANSLATE',
  'STAGE',
  'ROLLBACK',
  'TM_FILL',
  'IMPORT',
  'SOURCE_CHANGED',
  'BATCH',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  TRANSLATE: '修改译文',
  STAGE: '修改状态',
  ROLLBACK: '回滚',
  TM_FILL: '翻译记忆填充',
  IMPORT: '导入',
  SOURCE_CHANGED: '原文变更',
  BATCH: '批量操作',
};

export const JOB_TYPES = ['PARSE', 'EXPORT'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'ja', label: '日语' },
  { code: 'en', label: '英语' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁体中文' },
  { code: 'ko', label: '韩语' },
  { code: 'ru', label: '俄语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'vi', label: '越南语' },
  { code: 'th', label: '泰语' },
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

/**
 * RPG Maker 文本控制符，如 \C[2] \N[1] \V[10] \I[64] \. \| \! \> \< \^ \{ \} \$ \G \\
 * 用于编辑器高亮及「译文缺少控制符」检查。
 */
export const CONTROL_CODE_REGEX = /\\(?:[A-Za-z]+\[[^\]\n]*\]|[A-Za-z]+<[^>\n]*>|[.|!><^{}$\\]|[A-Za-z])/g;

export function extractControlCodes(text: string): string[] {
  return text.match(CONTROL_CODE_REGEX) ?? [];
}

/** 返回原文中有、但译文中缺失（或数量不足）的控制符 */
export function missingControlCodes(original: string, translation: string): string[] {
  const count = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const c of arr) m.set(c.toUpperCase(), (m.get(c.toUpperCase()) ?? 0) + 1);
    return m;
  };
  const a = count(extractControlCodes(original));
  const b = count(extractControlCodes(translation));
  const missing: string[] = [];
  for (const [code, n] of a) {
    const have = b.get(code) ?? 0;
    for (let i = have; i < n; i++) missing.push(code);
  }
  return missing;
}

// ───────────────────────── API 令牌 ─────────────────────────

export const TOKEN_SCOPES = ['READ', 'WRITE'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const TOKEN_SCOPE_LABELS: Record<TokenScope, string> = {
  READ: '只读',
  WRITE: '读写',
};

/** 可选有效期（天），最长 1 年 */
export const TOKEN_EXPIRY_DAYS = [7, 30, 90, 365] as const;
export const DEFAULT_TOKEN_EXPIRY_DAYS = 90;
export const TOKEN_PREFIX = 'gt_';
export const MAX_TOKENS_PER_USER = 20;
