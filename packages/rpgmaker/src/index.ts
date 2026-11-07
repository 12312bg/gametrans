import { ENGINE_EXTENSIONS, Engine, isRgssEngine } from '@gametrans/shared';
import { parseMvMzJson, parsePluginsJs } from './mvmz';
import { parseRgss } from './rgss';
import { ExtractedEntry, ParsedDocument, UnsupportedFileError } from './types';

export * from './types';
export * as marshal from './marshal';
export { findRubyStrings, escapeForQuote } from './rgss/ruby-lexer';
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
