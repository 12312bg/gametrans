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
  'message', 'system', 'map', 'mapName', 'variable', 'eventName', 'comment', 'note', 'script', 'plugin', 'other',
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

/** 默认隐藏的危险分类 */
export const DANGER_CATEGORIES: EntryCategory[] = ['mapName', 'variable', 'eventName', 'comment', 'note', 'script', 'plugin'];

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

/** 带参数的数字型控制符：参数应为数字（\V[1]、\N[2]、\C[3]、\I[87]、MZ 的 \FS[24]、\PX[10] 等） */
const NUMERIC_CODES = new Set(['V', 'N', 'P', 'C', 'I', 'FS', 'PX', 'PY']);

/** 编号占位符：%1、%2 …（MV/MZ 的系统用语、部分插件文本） */
const PLACEHOLDER_REGEX = /%\d+/g;

export function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_REGEX) ?? [];
}

export type SourceIssueKind = 'unclosedBracket' | 'badArgument' | 'emptyArgument' | 'fullWidth' | 'trailingBackslash';

export interface SourceIssue {
  kind: SourceIssueKind;
  /** 有问题的片段 */
  text: string;
  index: number;
}

/**
 * 原文中控制符本身的问题（与译文无关）：缺右括号、数字型控制符参数不是数字、
 * 全角反斜杠 / 括号、行末孤立的反斜杠等。这类问题导致的「缺失」不应算作译者漏掉。
 */
export function sourceCodeIssues(text: string): SourceIssue[] {
  const out: SourceIssue[] = [];
  for (const m of text.matchAll(/\\([A-Za-z]+)\[([^\]\n]*)(\]?)/g)) {
    const [whole, name, arg, close] = m;
    if (!close) out.push({ kind: 'unclosedBracket', text: whole.split(/\s/)[0], index: m.index! });
    else if (arg.trim() === '') out.push({ kind: 'emptyArgument', text: whole, index: m.index! });
    else if (NUMERIC_CODES.has(name.toUpperCase()) && !/^\d+$/.test(arg.trim())) out.push({ kind: 'badArgument', text: whole, index: m.index! });
  }
  for (const m of text.matchAll(/[＼][A-Za-z]+|\\[A-Za-z]+[［【][^］】\n]*[］】]?/g)) out.push({ kind: 'fullWidth', text: m[0], index: m.index! });
  for (const m of text.matchAll(/\\(?=\s*$)/gm)) out.push({ kind: 'trailingBackslash', text: '\\', index: m.index! });
  return out.sort((a, b) => a.index - b.index);
}

export interface MarkupReport {
  /** 原文中有、译文缺失（或数量不足）的控制符 */
  missingCodes: string[];
  /** 译文中多出来的控制符（可能是笔误） */
  extraCodes: string[];
  missingPlaceholders: string[];
  extraPlaceholders: string[];
  /** 插件标签，仅备注 / 注释类词条检查 */
  missingTags: string[];
  /** 原文控制符本身的问题 */
  sourceIssues: SourceIssue[];
}

const TAGGED_CATEGORIES = new Set(['comment', 'note']);

/**
 * 译文的控制符 / 占位符 / 标签检查。只比较数量，不要求顺序一致（%1 %2 可按语序调整）。
 * 译文为空时只报告原文问题。
 */
export function checkMarkup(original: string, translation: string, category?: string): MarkupReport {
  const sourceIssues = sourceCodeIssues(original);
  if (!translation) return { missingCodes: [], extraCodes: [], missingPlaceholders: [], extraPlaceholders: [], missingTags: [], sourceIssues };
  const so = extractControlCodes(original);
  const tr = extractControlCodes(translation);
  const po = extractPlaceholders(original);
  const pt = extractPlaceholders(translation);
  return {
    missingCodes: missingBy(so, tr, codeKey),
    extraCodes: missingBy(tr, so, codeKey),
    missingPlaceholders: missingBy(po, pt, (s) => s),
    extraPlaceholders: missingBy(pt, po, (s) => s),
    missingTags: category && TAGGED_CATEGORIES.has(category) ? missingTags(original, translation) : [],
    sourceIssues,
  };
}

/** 是否有「译文漏掉」类问题（严格模式据此拒绝写入） */
export const hasMissingMarkup = (r: MarkupReport) => r.missingCodes.length + r.missingPlaceholders.length + r.missingTags.length > 0;

/** 是否有任何需要提示的问题 */
export const hasMarkupWarnings = (r: MarkupReport) =>
  hasMissingMarkup(r) || r.extraCodes.length + r.extraPlaceholders.length + r.sourceIssues.length > 0;
