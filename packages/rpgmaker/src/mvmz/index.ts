import type { ContextPart } from '@gametrans/shared';
import { ctx as c, fileStem } from '../context';
import { CommandAdapter, WalkContext, walkEventList } from '../events';
import { DATABASE_FIELDS, detectKind } from '../kinds';
import { emitPluginValue } from '../plugin-params';
import { ParseOptions, ParsedDocument, Slot, UnsupportedFileError } from '../types';

interface JsonCommand {
  code: number;
  indent: number;
  parameters: unknown[];
}

type Json = Record<string, unknown>;

const jsonAdapter: CommandAdapter<JsonCommand> = {
  code: (cmd) => cmd.code,
  indent: (cmd) => cmd.indent,
  param: (cmd, i) => cmd.parameters?.[i],
  str: (cmd, i) => (typeof cmd.parameters?.[i] === 'string' ? (cmd.parameters[i] as string) : undefined),
  setStr: (cmd, i, v) => {
    cmd.parameters[i] = v;
  },
  arrLen: (cmd, i) => (Array.isArray(cmd.parameters?.[i]) ? (cmd.parameters[i] as unknown[]).length : 0),
  arrStr: (cmd, i, j) => {
    const arr = cmd.parameters?.[i];
    return Array.isArray(arr) && typeof arr[j] === 'string' ? (arr[j] as string) : undefined;
  },
  setArrStr: (cmd, i, j, v) => {
    (cmd.parameters[i] as unknown[])[j] = v;
  },
  makeLine: (template, code, text) => ({ code, indent: template.indent, parameters: [text] }),
  pluginArgs: (cmd) => {
    const a = cmd.parameters?.[3];
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : undefined;
  },
};

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function decodeText(bytes: Uint8Array): { text: string; bom: boolean } {
  const text = decoder.decode(bytes);
  const bom = text.charCodeAt(0) === 0xfeff;
  return { text: bom ? text.slice(1) : text, bom };
}

const encodeText = (text: string, bom: boolean) => encoder.encode(bom ? `﻿${text}` : text);

/** 按编辑器的排版输出：数据库为 "[\nnull,\n{...}\n]"，地图的 events 每个事件一行 */
export function stringifyLike(original: string, data: unknown): string {
  const trailing = /\n$/.test(original) ? '\n' : '';
  const pretty = /^[[{]\r?\n([ \t]+)\S/.exec(original);
  if (pretty) return JSON.stringify(data, null, pretty[1].startsWith('\t') ? '\t' : pretty[1].length) + trailing;
  if (Array.isArray(data) && /^\[\s*\n/.test(original)) return `[\n${data.map((x) => JSON.stringify(x)).join(',\n')}\n]${trailing}`;
  if (data && typeof data === 'object' && Array.isArray((data as Json).events) && original.includes('"events":[\n')) {
    const marker = '\u0000__GT_EVENTS__\u0000';
    const events = (data as Json).events as unknown[];
    const evText = `[\n${events.map((e) => JSON.stringify(e)).join(',\n')}\n]`;
    return JSON.stringify({ ...(data as Json), events: marker }).replace(JSON.stringify(marker), () => evText) + trailing;
  }
  return JSON.stringify(data) + trailing;
}

const nonBlank = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

export function parseMvMzJson(bytes: Uint8Array, opts: ParseOptions): ParsedDocument {
  const { text, bom } = decodeText(bytes);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UnsupportedFileError('JSON_INVALID', { detail: (e as Error).message });
  }
  const kind = detectKind(opts.path);
  const slots: Slot[] = [];
  const warnings: ParsedDocument['warnings'] = [];
  const walk: WalkContext = { emit: (s) => slots.push(s), finalizers: [] };
  const file = c.raw(fileStem(opts.path));

  const emitField = (obj: Json, field: string, key: string, context: ContextPart[], category: Slot['category'], danger = false) => {
    const v = obj[field];
    if (nonBlank(v)) slots.push({ key, original: v, context, category, danger, set: (nv) => (obj[field] = nv) });
  };
  const events = (list: unknown, keyPrefix: string, label: ContextPart[]) => {
    if (Array.isArray(list)) walkEventList(list as JsonCommand[], jsonAdapter, { keyPrefix, label, xpStyle: false }, walk);
  };

  if (kind === 'map' && data && typeof data === 'object') {
    const map = data as Json;
    emitField(map, 'displayName', 'displayName', [file, c.of('ctx.mapDisplayName')], 'map');
    emitField(map, 'note', 'note', [file, c.of('ctx.mapNote')], 'note', true);
    for (const ev of (Array.isArray(map.events) ? map.events : []) as (Json | null)[]) {
      if (!ev) continue;
      const id = ev.id as number;
      const evPart = c.event(id, String(ev.name ?? ''), ev.x, ev.y);
      emitField(ev, 'note', `events/${id}/note`, [file, evPart, c.of('ctx.eventNote')], 'note', true);
      ((ev.pages ?? []) as Json[]).forEach((page, p) => events(page?.list, `events/${id}/pages/${p}/list`, [file, evPart, c.page(p)]));
    }
  } else if (kind === 'common_events' && Array.isArray(data)) {
    for (const ce of data as (Json | null)[]) {
      if (ce) events(ce.list, `${String(ce.id)}/list`, [c.commonEvent(ce.id as number, String(ce.name ?? ''))]);
    }
  } else if (kind === 'troops' && Array.isArray(data)) {
    for (const tr of data as (Json | null)[]) {
      if (!tr || !Array.isArray(tr.pages)) continue;
      const trPart = c.troop(tr.id as number, String(tr.name ?? ''));
      (tr.pages as Json[]).forEach((page, p) => events(page?.list, `${String(tr.id)}/pages/${p}/list`, [trPart, c.page(p)]));
    }
  } else if (kind === 'system' && data && typeof data === 'object') {
    walkSystemJson(data as Json, slots);
  } else if (DATABASE_FIELDS[kind] && Array.isArray(data)) {
    for (const row of data as (Json | null)[]) {
      if (!row) continue;
      const rowPart = c.row(kind, row.id as number, String(row.name ?? ''));
      for (const f of DATABASE_FIELDS[kind]) {
        emitField(row, f.json, `${String(row.id)}/${f.json}`, [rowPart, c.field(f.json)], f.category, f.danger);
      }
    }
  } else if (kind === 'unknown') {
    warnings.push({ code: 'UNKNOWN_FILE' });
  }

  return {
    format: 'mvmz-json',
    kind,
    slots,
    warnings,
    serialize: () => {
      for (const fin of walk.finalizers.splice(0)) fin();
      return encodeText(stringifyLike(text, data), bom);
    },
  };
}

const SYSTEM_ARRAYS = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'];
const TERM_GROUPS = ['basic', 'commands', 'params', 'messages'];

function walkSystemJson(sys: Json, slots: Slot[]): void {
  const sysPart = c.of('ctx.system');
  const push = (holder: Record<string | number, unknown>, field: string | number, key: string, ...parts: ContextPart[]) => {
    const v = holder[field];
    if (nonBlank(v)) slots.push({ key, original: v, context: [sysPart, ...parts], category: 'system', danger: false, set: (nv) => (holder[field] = nv) });
  };
  push(sys, 'gameTitle', 'gameTitle', c.of('ctx.sys.gameTitle'));
  push(sys, 'currencyUnit', 'currencyUnit', c.of('ctx.sys.currencyUnit'));
  for (const name of SYSTEM_ARRAYS) {
    const arr = sys[name];
    if (Array.isArray(arr)) arr.forEach((_, i) => push(arr as unknown as Record<number, unknown>, i, `${name}/${i}`, c.of(`ctx.sys.${name}`, { i })));
  }
  const terms = sys.terms as Json | undefined;
  if (!terms || typeof terms !== 'object') return;
  const termsPart = c.of('ctx.sys.terms');
  for (const group of TERM_GROUPS) {
    const g = terms[group];
    if (Array.isArray(g)) {
      g.forEach((_, i) => push(g as unknown as Record<number, unknown>, i, `terms/${group}/${i}`, termsPart, c.of(`ctx.sys.term.${group}`, { i })));
    } else if (g && typeof g === 'object') {
      for (const k of Object.keys(g)) push(g as Json, k, `terms/${group}/${k}`, termsPart, c.of('ctx.sys.term.messages', { key: k }));
    }
  }
}

/** js/plugins.js：var $plugins = [ {...}, ... ]; */
export function parsePluginsJs(bytes: Uint8Array, _opts: ParseOptions): ParsedDocument {
  const { text, bom } = decodeText(bytes);
  const at = text.indexOf('$plugins');
  const start = text.indexOf('[', at);
  const end = text.lastIndexOf(']');
  if (at < 0 || start < 0 || end < start) throw new UnsupportedFileError('PLUGINS_NOT_FOUND');
  const [prefix, body, suffix] = [text.slice(0, start), text.slice(start, end + 1), text.slice(end + 1)];
  let plugins: Json[];
  try {
    plugins = JSON.parse(body) as Json[];
  } catch (e) {
    throw new UnsupportedFileError('PLUGINS_INVALID', { detail: (e as Error).message });
  }
  const slots: Slot[] = [];
  const walk: WalkContext = { emit: (s) => slots.push(s), finalizers: [] };
  const seen = new Map<string, number>();
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name ?? '');
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    const params = p.parameters as Record<string, unknown> | undefined;
    if (!params || typeof params !== 'object') continue;
    const plugin = c.of(p.status === false ? 'ctx.pluginDisabled' : 'ctx.plugin', { name });
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (typeof v !== 'string') continue;
      // 同名插件重复出现时键加序号，避免冲突
      const key = `${n > 1 ? `${name}#${n}` : name}/${k}`;
      emitPluginValue(v, key, [plugin, c.of('ctx.pluginParam', { name: k })], (nv) => (params[k] = nv), walk);
    }
  }
  return {
    format: 'mvmz-plugins',
    kind: 'plugins',
    slots,
    warnings: [],
    serialize: () => {
      for (const fin of walk.finalizers.splice(0)) fin();
      const out = /^\[\s*\n/.test(body) ? `[\n${plugins.map((x) => JSON.stringify(x)).join(',\n')}\n]` : JSON.stringify(plugins);
      return encodeText(prefix + out + suffix, bom);
    },
  };
}
