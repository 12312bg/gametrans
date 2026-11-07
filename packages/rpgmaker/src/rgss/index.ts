import { unzlibSync, zlibSync } from 'fflate';
import type { Engine } from '@gametrans/shared';
import { CommandAdapter, WalkContext, walkEventList } from '../events';
import { DATABASE_FIELDS, KIND_LABELS, detectKind } from '../kinds';
import { IvarList, RHash, RObject, RString, RValue, decodeUtf8, encodeUtf8, numOf, strOf } from '../marshal/types';
import { MarshalError, MarshalReader } from '../marshal/reader';
import { dump } from '../marshal/writer';
import { ParseOptions, ParsedDocument, Slot, UnsupportedFileError } from '../types';
import { escapeForQuote, findRubyStrings } from './ruby-lexer';

const nonBlank = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== '';

/** Ace（Ruby 1.9）字符串带 E=true 编码标记；XP/VX（Ruby 1.8）没有 */
function defaultStringIvars(engine: Engine): IvarList | undefined {
  return engine === 'RMVXACE' ? [['E', true]] : undefined;
}

function paramsOf(c: RObject): RValue[] {
  const p = c.get('parameters');
  return Array.isArray(p) ? p : [];
}

function makeAdapter(engine: Engine): CommandAdapter<RObject> {
  const defIvars = defaultStringIvars(engine);
  const setString = (holder: RValue[], i: number, v: string) => {
    const cur = holder[i];
    if (cur instanceof RString) cur.text = v;
    else holder[i] = RString.fromText(v, defIvars);
  };
  return {
    code: (c) => numOf(c.get('code')) ?? 0,
    indent: (c) => numOf(c.get('indent')) ?? 0,
    param: (c, i) => {
      const v = paramsOf(c)[i];
      return v instanceof RString ? v.text : v;
    },
    str: (c, i) => strOf(paramsOf(c)[i]),
    setStr: (c, i, v) => setString(paramsOf(c), i, v),
    arrLen: (c, i) => {
      const a = paramsOf(c)[i];
      return Array.isArray(a) ? a.length : 0;
    },
    arrStr: (c, i, j) => {
      const a = paramsOf(c)[i];
      return Array.isArray(a) ? strOf(a[j]) : undefined;
    },
    setArrStr: (c, i, j, v) => {
      const a = paramsOf(c)[i];
      if (Array.isArray(a)) setString(a, j, v);
    },
    makeLine: (template, code, text) => {
      const tplParam = paramsOf(template)[0];
      const ivars = tplParam instanceof RString ? tplParam.meta?.ivars : defIvars;
      const cmd = new RObject(template.className);
      for (const k of template.ivars.keys()) {
        if (k === '@code') cmd.ivars.set(k, code);
        else if (k === '@indent') cmd.ivars.set(k, template.get('indent') ?? 0);
        else if (k === '@parameters') cmd.ivars.set(k, [RString.fromText(text, ivars)]);
        else cmd.ivars.set(k, template.ivars.get(k) ?? null);
      }
      return cmd;
    },
  };
}

function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, '');
}

function eventListOf(holder: RObject): RObject[] | undefined {
  const list = holder.get('list');
  return Array.isArray(list) ? (list as RObject[]) : undefined;
}

export function parseRgss(bytes: Uint8Array, opts: ParseOptions): ParsedDocument {
  let root: RValue;
  try {
    root = MarshalReader.load(bytes);
  } catch (e) {
    if (e instanceof MarshalError) throw new UnsupportedFileError(`Marshal 解析失败：${e.message}`);
    throw e;
  }
  const engine = opts.engine;
  const xpStyle = engine === 'RMXP';
  const ad = makeAdapter(engine);
  const kind = detectKind(opts.path);
  const kindLabel = KIND_LABELS[kind] ?? kind;
  const stem = fileStem(opts.path);
  const slots: Slot[] = [];
  const warnings: string[] = [];
  const ctx: WalkContext = { emit: (s) => slots.push(s), finalizers: [] };
  const defIvars = defaultStringIvars(engine);

  const emitIvar = (obj: RObject, ivar: string, key: string, context: string, category: Slot['category'], danger = false) => {
    const v = obj.get(ivar);
    const text = strOf(v);
    if (!nonBlank(text)) return;
    slots.push({
      key,
      original: text,
      context,
      category,
      danger,
      set: (nv) => {
        const cur = obj.get(ivar);
        if (cur instanceof RString) cur.text = nv;
        else obj.set(ivar, RString.fromText(nv, defIvars));
      },
    });
  };

  if (kind === 'map' && root instanceof RObject) {
    emitIvar(root, 'display_name', 'display_name', `${stem} · 地图显示名`, 'map');
    emitIvar(root, 'note', 'note', `${stem} · 地图备注`, 'note', true);
    const events = root.get('events');
    if (events instanceof RHash) {
      for (const [, ev] of events.entries) {
        if (!(ev instanceof RObject)) continue;
        const id = numOf(ev.get('id')) ?? 0;
        const evLabel = `${stem} · 事件 #${id}「${strOf(ev.get('name')) ?? ''}」(${numOf(ev.get('x')) ?? '?'},${numOf(ev.get('y')) ?? '?'})`;
        const pages = ev.get('pages');
        if (!Array.isArray(pages)) continue;
        pages.forEach((page, p) => {
          if (!(page instanceof RObject)) return;
          const list = eventListOf(page);
          if (!list) return;
          walkEventList(list, ad, { keyPrefix: `events/${id}/pages/${p}/list`, label: `${evLabel} · 第${p + 1}页`, xpStyle }, ctx);
        });
      }
    }
  } else if (kind === 'common_events' && Array.isArray(root)) {
    for (const ce of root) {
      if (!(ce instanceof RObject)) continue;
      const list = eventListOf(ce);
      if (!list) continue;
      const id = numOf(ce.get('id')) ?? 0;
      walkEventList(list, ad, { keyPrefix: `${id}/list`, label: `公共事件 #${id}「${strOf(ce.get('name')) ?? ''}」`, xpStyle }, ctx);
    }
  } else if (kind === 'troops' && Array.isArray(root)) {
    for (const tr of root) {
      if (!(tr instanceof RObject)) continue;
      const id = numOf(tr.get('id')) ?? 0;
      const pages = tr.get('pages');
      if (!Array.isArray(pages)) continue;
      pages.forEach((page, p) => {
        if (!(page instanceof RObject)) return;
        const list = eventListOf(page);
        if (!list) return;
        walkEventList(
          list,
          ad,
          { keyPrefix: `${id}/pages/${p}/list`, label: `敌群 #${id}「${strOf(tr.get('name')) ?? ''}」· 第${p + 1}页`, xpStyle },
          ctx,
        );
      });
    }
  } else if (kind === 'system' && root instanceof RObject) {
    walkSystem(root, slots, defIvars);
  } else if (kind === 'scripts' && Array.isArray(root)) {
    walkScripts(root, slots, ctx, warnings);
  } else if (DATABASE_FIELDS[kind] && Array.isArray(root)) {
    for (const row of root) {
      if (!(row instanceof RObject)) continue;
      const id = numOf(row.get('id')) ?? 0;
      const rowLabel = `${kindLabel} #${id}「${strOf(row.get('name')) ?? ''}」`;
      for (const field of DATABASE_FIELDS[kind]) {
        emitIvar(row, field.ivar, `${id}/${field.ivar}`, `${rowLabel} · ${field.label}`, field.category, field.danger);
      }
    }
  } else if (kind === 'unknown') {
    warnings.push('未识别的数据文件，未提取任何文本');
  }

  return {
    format: 'rgss-marshal',
    kind,
    slots,
    warnings,
    serialize: () => {
      for (const fin of ctx.finalizers) fin();
      ctx.finalizers.length = 0;
      return dump(root);
    },
  };
}

const SYSTEM_STRINGS: [string, string][] = [
  ['game_title', '游戏标题'],
  ['currency_unit', '货币单位'],
];
const SYSTEM_ARRAYS: [string, string][] = [
  ['elements', '属性'],
  ['skill_types', '技能类型'],
  ['weapon_types', '武器类型'],
  ['armor_types', '防具类型'],
];

function walkSystem(sys: RObject, slots: Slot[], defIvars: IvarList | undefined): void {
  const pushStr = (holder: RValue[] | RObject, field: number | string, key: string, context: string) => {
    const v = holder instanceof RObject ? holder.get(field as string) : holder[field as number];
    const text = strOf(v);
    if (!nonBlank(text)) return;
    slots.push({
      key,
      original: text,
      context,
      category: 'system',
      danger: false,
      set: (nv) => {
        const cur = holder instanceof RObject ? holder.get(field as string) : holder[field as number];
        if (cur instanceof RString) cur.text = nv;
        else if (holder instanceof RObject) holder.set(field as string, RString.fromText(nv, defIvars));
        else holder[field as number] = RString.fromText(nv, defIvars);
      },
    });
  };
  for (const [ivar, label] of SYSTEM_STRINGS) pushStr(sys, ivar, ivar, `系统 · ${label}`);
  for (const [ivar, label] of SYSTEM_ARRAYS) {
    const arr = sys.get(ivar);
    if (Array.isArray(arr)) arr.forEach((_, i) => pushStr(arr, i, `${ivar}/${i}`, `系统 · ${label} #${i}`));
  }
  // VX/Ace：@terms；XP：@words。递归提取其中所有字符串
  for (const ivar of ['terms', 'words']) {
    const holder = sys.get(ivar);
    if (!(holder instanceof RObject)) continue;
    for (const [k, v] of holder.ivars) {
      const name = k.replace(/^@/, '');
      if (v instanceof RString) pushStr(holder, name, `${ivar}/${name}`, `系统 · 用语 · ${name}`);
      else if (Array.isArray(v)) v.forEach((_, i) => pushStr(v, i, `${ivar}/${name}/${i}`, `系统 · 用语 · ${name} #${i}`));
    }
  }
}

/** Scripts：[[id, name, zlib(code)], ...]，提取脚本中的字符串字面量 */
function walkScripts(root: RValue[], slots: Slot[], ctx: WalkContext, warnings: string[]): void {
  root.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 3) return;
    const nameStr = strOf(entry[1]) ?? '';
    const codeObj = entry[2];
    if (!(codeObj instanceof RString)) return;
    let code: string;
    try {
      code = decodeUtf8(unzlibSync(codeObj.bytes));
    } catch {
      warnings.push(`脚本 #${index}「${nameStr}」解压失败，已跳过`);
      return;
    }
    const literals = findRubyStrings(code);
    const replacements = new Map<number, string>();
    literals.forEach((lit, n) => {
      slots.push({
        key: `${index}/${n}`,
        original: lit.content,
        context: `脚本 #${index}「${nameStr}」· 第${lit.line}行`,
        category: 'script',
        danger: true,
        set: (v) => replacements.set(n, escapeForQuote(v, lit.quote)),
      });
    });
    ctx.finalizers.push(() => {
      if (!replacements.size) return;
      let out = code;
      // 从后往前替换，避免偏移变化
      for (let n = literals.length - 1; n >= 0; n--) {
        const rep = replacements.get(n);
        if (rep === undefined) continue;
        const lit = literals[n];
        out = out.slice(0, lit.start) + rep + out.slice(lit.end);
      }
      codeObj.bytes = zlibSync(encodeUtf8(out));
    });
  });
}
