import { ENGINE_EXTENSIONS, Engine, isRgssEngine } from '@gametrans/shared';
import { parseMvMzJson, parsePluginsJs } from './mvmz';
import { parseRgss } from './rgss';
import { ExtractedEntry, ParsedDocument, UnsupportedFileError } from './types';

export * from './types';
export * as marshal from './marshal';
export { findRubyStrings, escapeForQuote } from './rgss/ruby-lexer';
export { detectKind, KIND_LABELS } from './kinds';
export { stringifyLike } from './mvmz';

/** 解析一个数据文件，返回可提取 / 回写的文档 */
export function parseDocument(path: string, bytes: Uint8Array, engine: Engine): ParsedDocument {
  const lower = path.toLowerCase();
  if (isRgssEngine(engine)) {
    const ext = ENGINE_EXTENSIONS[engine][0];
    if (!lower.endsWith(ext)) throw new UnsupportedFileError(`该引擎只支持 ${ext} 文件`);
    return parseRgss(bytes, { engine, path });
  }
  if (lower.endsWith('.json')) return parseMvMzJson(bytes, { engine, path });
  if (/(^|\/)plugins\.js$/.test(lower)) return parsePluginsJs(bytes, { engine, path });
  throw new UnsupportedFileError('MV/MZ 只支持 data/*.json 与 js/plugins.js');
}

export interface ExtractResult {
  kind: string;
  entries: ExtractedEntry[];
  warnings: string[];
}

/** 提取文件中的全部可翻译文本 */
export function extractEntries(path: string, bytes: Uint8Array, engine: Engine): ExtractResult {
  const doc = parseDocument(path, bytes, engine);
  const seen = new Set<string>();
  const entries: ExtractedEntry[] = [];
  for (const { set: _set, ...e } of doc.slots) {
    if (seen.has(e.key)) continue; // 防御：键重复时只保留第一条
    seen.add(e.key);
    entries.push(e);
  }
  return { kind: doc.kind, entries, warnings: doc.warnings };
}

/**
 * 把译文写回原始文件，返回新文件内容。
 * translations：key → 译文；未出现在其中的词条保持原文。
 */
export function applyTranslations(
  path: string,
  bytes: Uint8Array,
  engine: Engine,
  translations: Map<string, string>,
): { data: Uint8Array; applied: number } {
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

const RGSS_DATA = /(^|\/)data\/[^/]+\.(rxdata|rvdata|rvdata2)$/i;
const MV_DATA = /(^|\/)data\/[^/]+\.json$/i;
const MV_PLUGINS = /(^|\/)js\/plugins\.js$/i;

/**
 * 判断压缩包 / 文件夹中的路径是否为该引擎可翻译的数据文件，
 * 返回规范化后的相对路径（去掉游戏根目录之前的部分），否则返回 null。
 */
export function normalizeGamePath(rawPath: string, engine: Engine): string | null {
  const path = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.split('/').some((seg) => seg === '..' || seg.startsWith('__MACOSX'))) return null;
  const base = path.split('/').pop() ?? '';
  if (base.startsWith('.')) return null;
  if (isRgssEngine(engine)) {
    const ext = ENGINE_EXTENSIONS[engine][0];
    if (!base.toLowerCase().endsWith(ext)) return null;
    const m = RGSS_DATA.exec(path);
    if (m) return path.slice(m.index + m[1].length).replace(/^data\//i, 'Data/');
    return path.includes('/') ? null : `Data/${base}`;
  }
  const md = MV_DATA.exec(path);
  if (md) {
    const rel = path.slice(md.index + md[1].length);
    const www = /(^|\/)www\/data\//i.test(path) ? 'www/' : '';
    return www + rel;
  }
  const mp = MV_PLUGINS.exec(path);
  if (mp) {
    const rel = path.slice(mp.index + mp[1].length);
    const www = /(^|\/)www\/js\//i.test(path) ? 'www/' : '';
    return www + rel;
  }
  if (!path.includes('/')) {
    if (/\.json$/i.test(base)) return `data/${base}`;
    if (/^plugins\.js$/i.test(base)) return `js/${base}`;
  }
  return null;
}
