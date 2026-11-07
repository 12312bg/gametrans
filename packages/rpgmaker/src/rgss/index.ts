import { unzlibSync, zlibSync } from 'fflate';
import type { ContextPart, Engine, Issue } from '@gametrans/shared';
import { ctx as c, fileStem } from '../context';
import { CommandAdapter, WalkContext, walkEventList } from '../events';
import { DATABASE_FIELDS, detectKind } from '../kinds';
import { MarshalError, MarshalReader } from '../marshal/reader';
import { IvarList, RHash, RObject, RString, RValue, decodeUtf8, encodeUtf8, numOf, strOf } from '../marshal/types';
import { dump } from '../marshal/writer';
import { ParseOptions, ParsedDocument, Slot, UnsupportedFileError } from '../types';
import { escapeForQuote, findRubyStrings } from './ruby-lexer';

const nonBlank = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== '';

/** Ace（Ruby 1.9）的字符串带 E=true 编码标记，XP/VX（Ruby 1.8）没有 */
const defaultStringIvars = (engine: Engine): IvarList | undefined => (engine === 'RMVXACE' ? [['E', true]] : undefined);

const paramsOf = (cmd: RObject): RValue[] => {
  const p = cmd.get('parameters');
  return Array.isArray(p) ? p : [];
};

function makeAdapter(engine: Engine): CommandAdapter<RObject> {
  const defIvars = defaultStringIvars(engine);
  const setString = (holder: RValue[], i: number, v: string) => {
    const cur = holder[i];
    if (cur instanceof RString) cur.text = v;
    else holder[i] = RString.fromText(v, defIvars);
  };
  return {
    code: (cmd) => numOf(cmd.get('code')) ?? 0,
    indent: (cmd) => numOf(cmd.get('indent')) ?? 0,
    param: (cmd, i) => {
      const v = paramsOf(cmd)[i];
      return v instanceof RString ? v.text : v;
    },
    str: (cmd, i) => strOf(paramsOf(cmd)[i]),
    setStr: (cmd, i, v) => setString(paramsOf(cmd), i, v),
    arrLen: (cmd, i) => {
      const a = paramsOf(cmd)[i];
      return Array.isArray(a) ? a.length : 0;
    },
    arrStr: (cmd, i, j) => {
      const a = paramsOf(cmd)[i];
      return Array.isArray(a) ? strOf(a[j]) : undefined;
    },
    setArrStr: (cmd, i, j, v) => {
      const a = paramsOf(cmd)[i];
      if (Array.isArray(a)) setString(a, j, v);
    },
    makeLine: (template, code, text) => {
      const tplParam = paramsOf(template)[0];
      const ivars = tplParam instanceof RString ? tplParam.meta?.ivars : defIvars;
      const cmd = new RObject(template.className);
      // 保持与样板相同的实例变量顺序
      for (const k of template.ivars.keys()) {
        if (k === '@code') cmd.ivars.set(k, code);
        else if (k === '@parameters') cmd.ivars.set(k, [RString.fromText(text, ivars)]);
        else cmd.ivars.set(k, template.ivars.get(k) ?? null);
      }
      return cmd;
    },
  };
}

const listOf = (holder: unknown): RObject[] | undefined => {
  const list = holder instanceof RObject ? holder.get('list') : undefined;
  return Array.isArray(list) ? (list as RObject[]) : undefined;
};

export function parseRgss(bytes: Uint8Array, opts: ParseOptions): ParsedDocument {
  let root: RValue;
  try {
    root = MarshalReader.load(bytes);
  } catch (e) {
    if (e instanceof MarshalError) throw new UnsupportedFileError('MARSHAL_INVALID', { detail: e.message });
    throw e;
  }
  const { engine } = opts;
  const xpStyle = engine === 'RMXP';
  const ad = makeAdapter(engine);
  const kind = detectKind(opts.path);
  const file = c.raw(fileStem(opts.path));
  const slots: Slot[] = [];
  const warnings: Issue[] = [];
  const walk: WalkContext = { emit: (s) => slots.push(s), finalizers: [] };
  const defIvars = defaultStringIvars(engine);

  const emitIvar = (obj: RObject, ivar: string, key: string, context: ContextPart[], category: Slot['category'], danger = false) => {
    const text = strOf(obj.get(ivar));
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
  const events = (holder: unknown, keyPrefix: string, label: ContextPart[]) => {
    const list = listOf(holder);
    if (list) walkEventList(list, ad, { keyPrefix, label, xpStyle }, walk);
  };
  const idOf = (o: RObject) => numOf(o.get('id')) ?? 0;
  const nameOf = (o: RObject) => strOf(o.get('name')) ?? '';

  if (kind === 'map' && root instanceof RObject) {
    emitIvar(root, 'display_name', 'display_name', [file, c.of('ctx.mapDisplayName')], 'map');
    emitIvar(root, 'note', 'note', [file, c.of('ctx.mapNote')], 'note', true);
    const evs = root.get('events');
    for (const [, ev] of evs instanceof RHash ? evs.entries : []) {
      if (!(ev instanceof RObject)) continue;
      const id = idOf(ev);
      const evPart = c.event(id, nameOf(ev), numOf(ev.get('x')), numOf(ev.get('y')));
      const pages = ev.get('pages');
      if (Array.isArray(pages)) pages.forEach((page, p) => events(page, `events/${id}/pages/${p}/list`, [file, evPart, c.page(p)]));
    }
  } else if (kind === 'common_events' && Array.isArray(root)) {
    for (const ce of root) {
      if (ce instanceof RObject) events(ce, `${idOf(ce)}/list`, [c.commonEvent(idOf(ce), nameOf(ce))]);
    }
  } else if (kind === 'troops' && Array.isArray(root)) {
    for (const tr of root) {
      if (!(tr instanceof RObject)) continue;
      const id = idOf(tr);
      const pages = tr.get('pages');
      if (Array.isArray(pages)) pages.forEach((page, p) => events(page, `${id}/pages/${p}/list`, [c.troop(id, nameOf(tr)), c.page(p)]));
    }
  } else if (kind === 'system' && root instanceof RObject) {
    walkSystem(root, slots, defIvars);
  } else if (kind === 'scripts' && Array.isArray(root)) {
    walkScripts(root, slots, walk, warnings);
  } else if (DATABASE_FIELDS[kind] && Array.isArray(root)) {
    for (const row of root) {
      if (!(row instanceof RObject)) continue;
      const rowPart = c.row(kind, idOf(row), nameOf(row));
      for (const f of DATABASE_FIELDS[kind]) emitIvar(row, f.ivar, `${idOf(row)}/${f.ivar}`, [rowPart, c.field(f.json)], f.category, f.danger);
    }
  } else if (kind === 'unknown') {
    warnings.push({ code: 'UNKNOWN_FILE' });
  }

  return {
    format: 'rgss-marshal',
    kind,
    slots,
    warnings,
    serialize: () => {
      for (const fin of walk.finalizers.splice(0)) fin();
      return dump(root);
    },
  };
}

/** RGSS 实例变量名 → 位置说明键 */
const SYSTEM_STRINGS: [string, string][] = [
  ['game_title', 'gameTitle'],
  ['currency_unit', 'currencyUnit'],
];
const SYSTEM_ARRAYS: [string, string][] = [
  ['elements', 'elements'],
  ['skill_types', 'skillTypes'],
  ['weapon_types', 'weaponTypes'],
  ['armor_types', 'armorTypes'],
];

function walkSystem(sys: RObject, slots: Slot[], defIvars: IvarList | undefined): void {
  const sysPart = c.of('ctx.system');
  const get = (holder: RValue[] | RObject, field: number | string) => (holder instanceof RObject ? holder.get(field as string) : holder[field as number]);
  const push = (holder: RValue[] | RObject, field: number | string, key: string, ...parts: ContextPart[]) => {
    const text = strOf(get(holder, field));
    if (!nonBlank(text)) return;
    slots.push({
      key,
      original: text,
      context: [sysPart, ...parts],
      category: 'system',
      danger: false,
      set: (nv) => {
        const cur = get(holder, field);
        if (cur instanceof RString) cur.text = nv;
        else if (holder instanceof RObject) holder.set(field as string, RString.fromText(nv, defIvars));
        else holder[field as number] = RString.fromText(nv, defIvars);
      },
    });
  };
  for (const [ivar, k] of SYSTEM_STRINGS) push(sys, ivar, ivar, c.of(`ctx.sys.${k}`));
  for (const [ivar, k] of SYSTEM_ARRAYS) {
    const arr = sys.get(ivar);
    if (Array.isArray(arr)) arr.forEach((_, i) => push(arr, i, `${ivar}/${i}`, c.of(`ctx.sys.${k}`, { i })));
  }
  // VX/Ace 为 @terms，XP 为 @words：提取其中全部字符串
  const termsPart = c.of('ctx.sys.terms');
  for (const ivar of ['terms', 'words']) {
    const holder = sys.get(ivar);
    if (!(holder instanceof RObject)) continue;
    for (const [k, v] of holder.ivars) {
      const name = k.replace(/^@/, '');
      if (v instanceof RString) push(holder, name, `${ivar}/${name}`, termsPart, c.raw(name));
      else if (Array.isArray(v)) v.forEach((_, i) => push(v, i, `${ivar}/${name}/${i}`, termsPart, c.rawIndex(name, i)));
    }
  }
}

/** Scripts：[[id, name, zlib(code)], ...]，提取脚本中的字符串字面量 */
function walkScripts(root: RValue[], slots: Slot[], walk: WalkContext, warnings: Issue[]): void {
  root.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 3) return;
    const name = strOf(entry[1]) ?? '';
    const codeObj = entry[2];
    if (!(codeObj instanceof RString)) return;
    let code: string;
    try {
      code = decodeUtf8(unzlibSync(codeObj.bytes));
    } catch {
      warnings.push({ code: 'SCRIPT_INFLATE_FAILED', params: { index, name } });
      return;
    }
    const literals = findRubyStrings(code);
    const replacements = new Map<number, string>();
    const scriptPart = c.of('ctx.script', { index, name });
    literals.forEach((lit, n) => {
      slots.push({
        key: `${index}/${n}`,
        original: lit.content,
        context: [scriptPart, c.of('ctx.line', { n: lit.line })],
        category: 'script',
        danger: true,
        set: (v) => replacements.set(n, escapeForQuote(v, lit.quote)),
      });
    });
    walk.finalizers.push(() => {
      if (!replacements.size) return;
      let out = code;
      // 从后往前替换，避免偏移变化
      for (let n = literals.length - 1; n >= 0; n--) {
        const rep = replacements.get(n);
        if (rep !== undefined) out = out.slice(0, literals[n].start) + rep + out.slice(literals[n].end);
      }
      codeObj.bytes = zlibSync(encodeUtf8(out));
    });
  });
}
