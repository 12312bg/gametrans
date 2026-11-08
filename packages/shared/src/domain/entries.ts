import { PERMISSIONS, Permission } from './permissions';

export const STAGES = ['UNTRANSLATED', 'TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED', 'HIDDEN'] as const;
export type Stage = (typeof STAGES)[number];

const P = PERMISSIONS;

export function permissionToEdit(stage: Stage): Permission {
  if (stage === 'REVIEWED') return P.REVIEW;
  if (stage === 'LOCKED' || stage === 'HIDDEN') return P.MANAGE_ENTRIES;
  return P.TRANSLATE;
}

/** 状态变更所需权限，不变返回 null */
export function permissionForTransition(from: Stage, to: Stage): Permission | null {
  if (from === to) return null;
  if ([from, to].some((s) => s === 'LOCKED' || s === 'HIDDEN')) return P.MANAGE_ENTRIES;
  if (from === 'REVIEWED' || to === 'REVIEWED') return P.REVIEW;
  return P.TRANSLATE;
}

export const BATCH_ACTIONS = ['review', 'unreview', 'lock', 'unlock', 'hide', 'unhide', 'question', 'clear'] as const;
export type BatchAction = (typeof BATCH_ACTIONS)[number];

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

export const ENTRY_CATEGORIES = [
  'dialogue', 'choice', 'scroll', 'speaker', 'name', 'nickname', 'description',
  'message', 'system', 'map', 'variable', 'note', 'script', 'plugin', 'other',
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

/** 默认隐藏的危险分类 */
export const DANGER_CATEGORIES: EntryCategory[] = ['variable', 'note', 'script', 'plugin'];

/** 原文相同时译文需要保持一致的分类：脚本里赋值与比较的往往是同一个值 */
export const LINKED_CATEGORIES: EntryCategory[] = ['script', 'plugin'];

export const HISTORY_ACTIONS = ['TRANSLATE', 'STAGE', 'ROLLBACK', 'TM_FILL', 'IMPORT', 'SOURCE_CHANGED', 'BATCH', 'SYNC'] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const JOB_TYPES = ['PARSE', 'EXPORT'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 项目可选的源 / 目标语言（显示名见 i18n 的 lang.*） */
export const LANGUAGE_CODES = ['ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'ru', 'fr', 'de', 'es', 'pt', 'vi', 'th'] as const;

/** RPG Maker 控制符，如 \C[2] \N[1] \V[10] \I[64] \. \| \! \> \< \^ \{ \} \$ \G \\ */
export const CONTROL_CODE_REGEX = /\\(?:[A-Za-z]+\[[^\]\n]*\]|[A-Za-z]+<[^>\n]*>|[.|!><^{}$\\]|[A-Za-z])/g;

export function extractControlCodes(text: string): string[] {
  return text.match(CONTROL_CODE_REGEX) ?? [];
}

/** 原文中有、译文中缺失（或数量不足）的控制符 */
export function missingControlCodes(original: string, translation: string): string[] {
  const count = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const c of arr) m.set(c.toUpperCase(), (m.get(c.toUpperCase()) ?? 0) + 1);
    return m;
  };
  const have = count(extractControlCodes(translation));
  const missing: string[] = [];
  for (const [code, n] of count(extractControlCodes(original))) {
    for (let i = have.get(code) ?? 0; i < n; i++) missing.push(code);
  }
  return missing;
}
