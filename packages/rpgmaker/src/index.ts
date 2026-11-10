import { ENGINE_EXTENSIONS, Engine, isRgssEngine } from '@gametrans/shared';
import { parseMvMzJson, parsePluginsJs } from './mvmz';
import { parseRgss } from './rgss';
import { JsonChange, applyPreEdit } from './preedit';
import { ExtractedEntry, ParsedDocument, UnsupportedFileError } from './types';

export * from './types';
export * as marshal from './marshal';
export { findRubyStrings, escapeForQuote } from './rgss/ruby-lexer';
export { findJsStrings, escapeJsString } from './script-strings';
export { detectKind } from './kinds';
export { stringifyLike } from './mvmz';

export function parseDocument(path: string, bytes: Uint8Array, engine: Engine): ParsedDocument {
  const lower = path.toLowerCase();
  if (isRgssEngine(engine)) {
    const ext = ENGINE_EXTENSIONS[engine][0];
    if (!lower.endsWith(ext)) throw new UnsupportedFileError('WRONG_EXTENSION', { ext });
    return parseRgss(bytes, { engine, path });
  }
  if (lower.endsWith('.json')) return parseMvMzJson(bytes, { engine, path });
  if (/(^|\/)plugins\.js$/.test(lower)) return parsePluginsJs(bytes, { engine, path });
  throw new UnsupportedFileError('MVMZ_UNSUPPORTED');
}

export interface ExtractResult {
  kind: string;
  entries: ExtractedEntry[];
  warnings: ParsedDocument['warnings'];
}

export function extractEntries(path: string, bytes: Uint8Array, engine: Engine): ExtractResult {
  const doc = parseDocument(path, bytes, engine);
  const seen = new Set<string>();
  const entries: ExtractedEntry[] = [];
  for (const { set: _set, ...e } of doc.slots) {
    if (seen.has(e.key)) continue; // 防御：键重复时保留第一条
    seen.add(e.key);
    entries.push(e);
  }
  return { kind: doc.kind, entries, warnings: doc.warnings };
}

/** 把译文（key → 译文）写回原始文件，未出现的词条保持原文 */
export function applyTranslations(path: string, bytes: Uint8Array, engine: Engine, translations: Map<string, string>) {
  const doc = parseDocument(path, bytes, engine);
  let applied = 0;
  for (const slot of doc.slots) {
    const t = translations.get(slot.key);
    if (t === undefined || t === slot.original) continue;
    slot.set(t);
    applied++;
  }
  return { data: doc.serialize(), applied };
}

export * from './preedit';

/**
 * 预编辑不能改动已提取的词条：应用后重新提取，键与原文必须与原文件完全一致。
 * 返回被改动的词条（为空表示可以保存）。
 */
export function preEditTouchedEntries(path: string, bytes: Uint8Array, engine: Engine, patch: JsonChange[]) {
  const before = new Map(extractEntries(path, bytes, engine).entries.map((e) => [e.key, e.original]));
  const after = new Map(extractEntries(path, applyPreEdit(path, bytes, patch).data, engine).entries.map((e) => [e.key, e.original]));
  const touched: { key: string; before?: string; after?: string }[] = [];
  for (const [key, original] of before) if (after.get(key) !== original) touched.push({ key, before: original, after: after.get(key) });
  for (const [key, original] of after) if (!before.has(key)) touched.push({ key, after: original });
  return touched;
}
