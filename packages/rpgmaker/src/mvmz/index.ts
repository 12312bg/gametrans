import { CommandAdapter, WalkContext, walkEventList } from '../events';
import { DATABASE_FIELDS, KIND_LABELS, detectKind } from '../kinds';
import { emitPluginValue } from '../plugin-params';
import { ParseOptions, ParsedDocument, Slot, UnsupportedFileError } from '../types';

interface JsonCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

type Json = Record<string, unknown>;

const jsonAdapter: CommandAdapter<JsonCommand> = {
  code: (c) => c.code,
  indent: (c) => c.indent,
  param: (c, i) => c.parameters?.[i],
  str: (c, i) => (typeof c.parameters?.[i] === 'string' ? (c.parameters[i] as string) : undefined),
  setStr: (c, i, v) => {
    c.parameters[i] = v;
  },
  arrLen: (c, i) => (Array.isArray(c.parameters?.[i]) ? (c.parameters[i] as unknown[]).length : 0),
  arrStr: (c, i, j) => {
    const arr = c.parameters?.[i];
    return Array.isArray(arr) && typeof arr[j] === 'string' ? (arr[j] as string) : undefined;
  },
  setArrStr: (c, i, j, v) => {
    (c.parameters[i] as unknown[])[j] = v;
  },
  makeLine: (template, code, text) => ({ code, indent: template.indent, parameters: [text] }),
  pluginArgs: (c) => {
    const a = c.parameters?.[3];
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
  },
};

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function decodeText(bytes: Uint8Array): { text: string; bom: boolean } {
  let text = decoder.decode(bytes);
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  return { text, bom };
}

function encodeText(text: string, bom: boolean): Uint8Array {
  return encoder.encode(bom ? `﻿${text}` : text);
}

/**
 * 按 RPG Maker MV/MZ 编辑器的格式输出 JSON：
 * 数据库文件为 "[\nnull,\n{...},\n{...}\n]"，地图文件的 events 数组每个事件一行。
 */
export function stringifyLike(original: string, data: unknown): string {
  const trailing = /\n$/.test(original) ? '\n' : '';
  const pretty = /^[[{]\r?\n([ \t]+)\S/.exec(original);
  if (pretty) {
    return JSON.stringify(data, null, pretty[1].startsWith('\t') ? '\t' : pretty[1].length) + trailing;
  }
  if (Array.isArray(data) && /^\[\s*\n/.test(original)) {
    return `[\n${data.map((x) => JSON.stringify(x)).join(',\n')}\n]${trailing}`;
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray((data as Json).events)) {
    if (original.includes('"events":[\n')) {
      const marker = '\u0000__GT_EVENTS__\u0000';
      const events = (data as Json).events as unknown[];
      const s = JSON.stringify({ ...(data as Json), events: marker });
      const evText = `[\n${events.map((e) => JSON.stringify(e)).join(',\n')}\n]`;
      return s.replace(JSON.stringify(marker), () => evText) + trailing;
    }
  }
  return JSON.stringify(data) + trailing;
}

const nonBlank = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, '');
}

export function parseMvMzJson(bytes: Uint8Array, opts: ParseOptions): ParsedDocument {
  const { text, bom } = decodeText(bytes);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UnsupportedFileError(`JSON 解析失败：${(e as Error).message}`);
  }
  const kind = detectKind(opts.path);
  const slots: Slot[] = [];
  const warnings: string[] = [];
  const ctx: WalkContext = { emit: (s) => slots.push(s), finalizers: [] };
  const stem = fileStem(opts.path);
  const kindLabel = KIND_LABELS[kind] ?? kind;

  const emitField = (obj: Json, field: string, key: string, context: string, category: Slot['category'], danger = false) => {
    const v = obj[field];
    if (!nonBlank(v)) return;
    slots.push({ key, original: v, context, category, danger, set: (nv) => (obj[field] = nv) });
  };

  if (kind === 'map' && data && typeof data === 'object') {
    const map = data as Json;
    emitField(map, 'displayName', 'displayName', `${stem} · 地图显示名`, 'map');
    emitField(map, 'note', 'note', `${stem} · 地图备注`, 'note', true);
    const events = Array.isArray(map.events) ? (map.events as (Json | null)[]) : [];
    for (const ev of events) {
      if (!ev) continue;
      const id = ev.id as number;
      const evLabel = `${stem} · 事件 #${id}「${String(ev.name ?? '')}」(${String(ev.x)},${String(ev.y)})`;
      emitField(ev, 'note', `events/${id}/note`, `${evLabel} · 事件备注`, 'note', true);
      const pages = Array.isArray(ev.pages) ? (ev.pages as Json[]) : [];
      pages.forEach((page, p) => {
        if (!Array.isArray(page?.list)) return;
        walkEventList(
          page.list as JsonCommand[],
          jsonAdapter,
          { keyPrefix: `events/${id}/pages/${p}/list`, label: `${evLabel} · 第${p + 1}页`, xpStyle: false },
          ctx,
        );
      });
    }
  } else if (kind === 'common_events' && Array.isArray(data)) {
    for (const ce of data as (Json | null)[]) {
      if (!ce || !Array.isArray(ce.list)) continue;
      walkEventList(
        ce.list as JsonCommand[],
        jsonAdapter,
        { keyPrefix: `${String(ce.id)}/list`, label: `公共事件 #${String(ce.id)}「${String(ce.name ?? '')}」`, xpStyle: false },
        ctx,
      );
    }
  } else if (kind === 'troops' && Array.isArray(data)) {
    for (const tr of data as (Json | null)[]) {
      if (!tr || !Array.isArray(tr.pages)) continue;
      (tr.pages as Json[]).forEach((page, p) => {
        if (!Array.isArray(page?.list)) return;
        walkEventList(
          page.list as JsonCommand[],
          jsonAdapter,
          {
            keyPrefix: `${String(tr.id)}/pages/${p}/list`,
            label: `敌群 #${String(tr.id)}「${String(tr.name ?? '')}」· 第${p + 1}页`,
            xpStyle: false,
          },
          ctx,
        );
      });
    }
  } else if (kind === 'system' && data && typeof data === 'object') {
    walkSystemJson(data as Json, slots);
  } else if (DATABASE_FIELDS[kind] && Array.isArray(data)) {
    for (const row of data as (Json | null)[]) {
      if (!row) continue;
      const rowLabel = `${kindLabel} #${String(row.id)}「${String(row.name ?? '')}」`;
      for (const field of DATABASE_FIELDS[kind]) {
        emitField(row, field.json, `${String(row.id)}/${field.json}`, `${rowLabel} · ${field.label}`, field.category, field.danger);
      }
    }
  } else if (kind === 'unknown') {
    warnings.push('未识别的数据文件，未提取任何文本');
  }

  return {
    format: 'mvmz-json',
    kind,
    slots,
    warnings,
    serialize: () => {
      for (const fin of ctx.finalizers) fin();
      ctx.finalizers.length = 0;
      return encodeText(stringifyLike(text, data), bom);
    },
  };
}

const SYSTEM_ARRAYS: [string, string][] = [
  ['elements', '属性'],
  ['skillTypes', '技能类型'],
  ['weaponTypes', '武器类型'],
  ['armorTypes', '防具类型'],
  ['equipTypes', '装备类型'],
];

const TERM_GROUPS: [string, string][] = [
  ['basic', '基本用语'],
  ['commands', '指令'],
  ['params', '能力值'],
  ['messages', '信息'],
];

function walkSystemJson(sys: Json, slots: Slot[]): void {
  const push = (holder: Record<string | number, unknown>, field: string | number, key: string, context: string) => {
    const v = holder[field];
    if (!nonBlank(v)) return;
    slots.push({ key, original: v, context, category: 'system', danger: false, set: (nv) => (holder[field] = nv) });
  };
  push(sys, 'gameTitle', 'gameTitle', '系统 · 游戏标题');
  push(sys, 'currencyUnit', 'currencyUnit', '系统 · 货币单位');
  for (const [name, label] of SYSTEM_ARRAYS) {
    const arr = sys[name];
    if (!Array.isArray(arr)) continue;
    arr.forEach((_, i) => push(arr as unknown as Record<number, unknown>, i, `${name}/${i}`, `系统 · ${label} #${i}`));
  }
  const terms = sys.terms as Json | undefined;
  if (terms && typeof terms === 'object') {
    for (const [group, label] of TERM_GROUPS) {
      const g = terms[group];
      if (Array.isArray(g)) {
        g.forEach((_, i) => push(g as unknown as Record<number, unknown>, i, `terms/${group}/${i}`, `系统 · 用语 · ${label} #${i}`));
      } else if (g && typeof g === 'object') {
        for (const k of Object.keys(g)) push(g as Json, k, `terms/${group}/${k}`, `系统 · 用语 · ${label} · ${k}`);
      }
    }
  }
}

/** js/plugins.js：var $plugins = [ {...}, ... ]; */
export function parsePluginsJs(bytes: Uint8Array, _opts: ParseOptions): ParsedDocument {
  const { text, bom } = decodeText(bytes);
  const start = text.indexOf('[', text.indexOf('$plugins'));
  const end = text.lastIndexOf(']');
  if (text.indexOf('$plugins') < 0 || start < 0 || end < start) {
    throw new UnsupportedFileError('plugins.js 中未找到 $plugins 数组');
  }
  const prefix = text.slice(0, start);
  const body = text.slice(start, end + 1);
  const suffix = text.slice(end + 1);
  let plugins: Json[];
  try {
    plugins = JSON.parse(body) as Json[];
  } catch (e) {
    throw new UnsupportedFileError(`plugins.js 解析失败：${(e as Error).message}`);
  }
  const slots: Slot[] = [];
  const ctx: WalkContext = { emit: (s) => slots.push(s), finalizers: [] };
  const seen = new Map<string, number>();
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name ?? '');
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const pkey = n > 1 ? `${name}#${n}` : name;
    const params = p.parameters as Record<string, unknown> | undefined;
    if (!params || typeof params !== 'object') continue;
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (typeof v !== 'string') continue;
      emitPluginValue(v, `${pkey}/${k}`, `插件 ${name}${p.status === false ? '（未启用）' : ''} · 参数「${k}」`, (nv) => (params[k] = nv), ctx);
    }
  }
  return {
    format: 'mvmz-plugins',
    kind: 'plugins',
    slots,
    warnings: [],
    serialize: () => {
      for (const fin of ctx.finalizers) fin();
      ctx.finalizers.length = 0;
      const out = /^\[\s*\n/.test(body)
        ? `[\n${plugins.map((x) => JSON.stringify(x)).join(',\n')}\n]`
        : JSON.stringify(plugins);
      return encodeText(prefix + out + suffix, bom);
    },
  };
}
