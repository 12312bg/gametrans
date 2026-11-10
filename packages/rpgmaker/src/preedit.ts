import { UnsupportedFileError } from './types';
import { decodeText, encodeText, joinPluginsJs, splitPluginsJs, stringifyLike } from './mvmz';

/**
 * 数据文件的预编辑：以「相对原文件的 JSON 字段变更」保存，导出时先应用到原文件、再写入译文。
 * 只支持文本格式的 MV/MZ 数据文件（data/*.json、js/plugins.js 的 $plugins 数组）。
 */

export type JsonPath = (string | number)[];
/** 没有 before 表示新增字段，没有 after 表示删除字段 */
export interface JsonChange {
  path: JsonPath;
  before?: unknown;
  after?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 逐字段比较；数组长度不同时整体替换 */
export function diffJson(a: unknown, b: unknown, path: JsonPath = [], out: JsonChange[] = []): JsonChange[] {
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    a.forEach((x, i) => diffJson(x, b[i], [...path, i], out));
  } else if (isObject(a) && isObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b)) out.push({ path: [...path, k], before: a[k] });
      else if (!(k in a)) out.push({ path: [...path, k], after: b[k] });
      else diffJson(a[k], b[k], [...path, k], out);
    }
  } else if (!equal(a, b)) {
    out.push({ path, before: a, after: b });
  }
  return out;
}

/** 应用变更；当前值与 before 不一致（原文件已更新）时跳过并计入冲突 */
export function applyJsonPatch(root: unknown, changes: JsonChange[]): { value: unknown; conflicts: JsonChange[] } {
  const conflicts: JsonChange[] = [];
  let value = root;
  for (const ch of changes) {
    if (!ch.path.length) {
      if ('before' in ch && !equal(value, ch.before)) conflicts.push(ch);
      else value = ch.after;
      continue;
    }
    let parent: unknown = value;
    for (const k of ch.path.slice(0, -1)) parent = parent && typeof parent === 'object' ? (parent as Record<string | number, unknown>)[k] : undefined;
    const last = ch.path[ch.path.length - 1];
    if (!parent || typeof parent !== 'object') {
      conflicts.push(ch);
      continue;
    }
    const holder = parent as Record<string | number, unknown>;
    const exists = Object.prototype.hasOwnProperty.call(holder, last);
    const ok = 'before' in ch ? exists && equal(holder[last], ch.before) : !exists || equal(holder[last], ch.after);
    if (!ok) {
      conflicts.push(ch);
      continue;
    }
    if ('after' in ch) holder[last] = ch.after;
    else delete holder[last];
  }
  return { value, conflicts };
}

/** 便于阅读的 JSON：短的值、只含基本类型的数组（如地图图块）保持一行 */
export function prettyJson(v: unknown, indent = ''): string {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || one.length <= 120) return one;
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== 'object')) return one;
    return `[\n${v.map((x) => inner + prettyJson(x, inner)).join(',\n')}\n${indent}]`;
  }
  return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${prettyJson(x, inner)}`).join(',\n')}\n${indent}}`;
}

const isPlugins = (path: string) => /(^|\/)plugins\.js$/i.test(path);
export const isPreEditable = (path: string) => /\.json$/i.test(path) || isPlugins(path);

/** 可预编辑的内容：data/*.json 为整个文件，plugins.js 为 $plugins 数组 */
export function readEditable(path: string, bytes: Uint8Array): unknown {
  if (!isPreEditable(path)) throw new UnsupportedFileError('PREEDIT_UNSUPPORTED');
  const { text } = decodeText(bytes);
  if (isPlugins(path)) return splitPluginsJs(text).plugins;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UnsupportedFileError('JSON_INVALID', { detail: (e as Error).message });
  }
}

/** 编辑器中显示的文本（应用预编辑后） */
export function editableText(path: string, bytes: Uint8Array, patch?: JsonChange[]): string {
  const value = readEditable(path, bytes);
  return prettyJson(patch?.length ? applyJsonPatch(value, patch).value : value);
}

/** 由编辑后的文本计算相对原文件的变更 */
export function computePatch(path: string, bytes: Uint8Array, editedText: string): JsonChange[] {
  let edited: unknown;
  try {
    edited = JSON.parse(editedText);
  } catch (e) {
    throw new UnsupportedFileError('PREEDIT_INVALID_JSON', { detail: (e as Error).message });
  }
  if (isPlugins(path) && !Array.isArray(edited)) throw new UnsupportedFileError('PREEDIT_INVALID_JSON', { detail: '$plugins must be an array' });
  return diffJson(readEditable(path, bytes), edited);
}

/** 把预编辑应用到原文件，按原文件的排版写出 */
export function applyPreEdit(path: string, bytes: Uint8Array, patch: JsonChange[]): { data: Uint8Array; conflicts: number } {
  const { text, bom } = decodeText(bytes);
  if (isPlugins(path)) {
    const { prefix, body, suffix, plugins } = splitPluginsJs(text);
    const { value, conflicts } = applyJsonPatch(plugins, patch);
    return { data: encodeText(joinPluginsJs(prefix, body, suffix, value as unknown[]), bom), conflicts: conflicts.length };
  }
  const { value, conflicts } = applyJsonPatch(JSON.parse(text), patch);
  return { data: encodeText(stringifyLike(text, value), bom), conflicts: conflicts.length };
}
