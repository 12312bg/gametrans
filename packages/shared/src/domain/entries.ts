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
  'message', 'system', 'map', 'variable', 'eventName', 'comment', 'note', 'script', 'plugin', 'other',
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

/** 默认隐藏的危险分类 */
export const DANGER_CATEGORIES: EntryCategory[] = ['variable', 'eventName', 'comment', 'note', 'script', 'plugin'];

/** 原文相同时译文需要保持一致的分类：脚本里赋值与比较的往往是同一个值 */
export const LINKED_CATEGORIES: EntryCategory[] = ['script', 'plugin'];

export const HISTORY_ACTIONS = ['TRANSLATE', 'STAGE', 'ROLLBACK', 'TM_FILL', 'IMPORT', 'SOURCE_CHANGED', 'BATCH', 'SYNC', 'REPLACE'] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export const JOB_TYPES = ['PARSE', 'EXPORT'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** 项目可选的源 / 目标语言（显示名见 i18n 的 lang.*） */
export const LANGUAGE_CODES = ['ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'ru', 'fr', 'de', 'es', 'pt', 'vi', 'th'] as const;

/** RPG Maker 控制符，如 \C[2] \N[1] \V[10] \I[64] \. \| \! \> \< \^ \{ \} \$ \G \\ */
export const CONTROL_CODE_REGEX = /\\(?:[A-Za-z]+\[[^\]\n]*\]|[A-Za-z]+<[^>\n]*>|[.|!><^{}$\\]|[A-Za-z])/g;

/** YEP / VisuStella 的名字框 \n<名字>、\nc<…>、\nr<…>：其中的名字是要翻译的文本 */
export const NAME_BOX_REGEX = /^\\[nN][a-zA-Z]{0,2}<[^>\n]*>$/;

export function extractControlCodes(text: string): string[] {
  return text.match(CONTROL_CODE_REGEX) ?? [];
}

/** 控制符在文本中的位置；名字框只标出 \n< 与 >，中间的名字按普通文本处理 */
export function controlCodeSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(new RegExp(CONTROL_CODE_REGEX.source, 'g'))) {
    const start = m.index!;
    const code = m[0];
    if (NAME_BOX_REGEX.test(code)) {
      const lt = code.indexOf('<');
      out.push({ start, end: start + lt + 1 }, { start: start + code.length - 1, end: start + code.length });
    } else {
      out.push({ start, end: start + code.length });
    }
  }
  return out;
}

/** 比较用的控制符：不区分大小写，名字框忽略其中的名字 */
const codeKey = (code: string) => (NAME_BOX_REGEX.test(code) ? `${code.slice(0, code.indexOf('<'))}<…>` : code).toUpperCase();

function countBy(items: string[], key: (s: string) => string) {
  const m = new Map<string, { n: number; sample: string }>();
  for (const s of items) {
    const k = key(s);
    const hit = m.get(k);
    if (hit) hit.n++;
    else m.set(k, { n: 1, sample: s });
  }
  return m;
}

function missingBy(original: string[], translation: string[], key: (s: string) => string): string[] {
  const have = countBy(translation, key);
  const missing: string[] = [];
  for (const [k, { n, sample }] of countBy(original, key)) {
    for (let i = have.get(k)?.n ?? 0; i < n; i++) missing.push(sample);
  }
  return missing;
}

/** 原文中有、译文中缺失（或数量不足）的控制符 */
export function missingControlCodes(original: string, translation: string): string[] {
  return missingBy(extractControlCodes(original), extractControlCodes(translation), codeKey);
}

/** 插件读取的标签，如 <Help Description>、</Subtext>、<Menu Name: x>；只比较标签名 */
const TAG_REGEX = /(?<!\\[A-Za-z]{0,3})<\s*(\/?)\s*([A-Za-z][\w \-]*?)\s*(?::[^<>\n]*)?>/g;

export function extractTags(text: string): string[] {
  return Array.from(text.matchAll(TAG_REGEX), (m) => `<${m[1]}${m[2]}>`);
}

/** 原文中有、译文中缺失的标签（备注、注释中插件读取的标签） */
export function missingTags(original: string, translation: string): string[] {
  return missingBy(extractTags(original), extractTags(translation), (t) => t.toLowerCase());
}
