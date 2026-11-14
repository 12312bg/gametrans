import type { BranchStep, ContextPart, EntryCategory } from '@gametrans/shared';
import type { Slot } from './types';
import { emitPluginValue } from './plugin-params';
import { ScriptLang, emitScriptStrings } from './script-strings';

/** 事件指令访问适配器：MV/MZ（JSON）与 XP/VX/Ace（Marshal）共用遍历逻辑 */
export interface CommandAdapter<C> {
  code(c: C): number;
  indent(c: C): number;
  param(c: C, i: number): unknown;
  str(c: C, i: number): string | undefined;
  setStr(c: C, i: number, v: string): void;
  arrLen(c: C, i: number): number;
  arrStr(c: C, i: number, j: number): string | undefined;
  setArrStr(c: C, i: number, j: number, v: string): void;
  /** 以 template 为样板（缩进、字符串编码）新建一条单字符串参数的指令 */
  makeLine(template: C, code: number, text: string): C;
  /** MZ 插件指令（357）的参数对象 */
  pluginArgs?(c: C): Record<string, unknown> | undefined;
}

export interface WalkContext {
  emit(slot: Slot): void;
  finalizers: (() => void)[];
}

export interface EventListInfo {
  keyPrefix: string;
  label: ContextPart[];
  /** XP 的「显示文章」(101) 自身携带第一行 */
  xpStyle: boolean;
  scriptLang: ScriptLang;
  /** 「控制变量」的操作数 4 是脚本（VX Ace、MV、MZ）；XP / VX 中 4 是角色 */
  scriptOperand: boolean;
}

/** 注释中独占一行的开始 / 结束标签，如 <Help Description>、</Subtext>（不含取值） */
const OPEN_TAG = /^<([A-Za-z][\w \-]*)>$/;
const CLOSE_TAG = /^<\/([A-Za-z][\w \-]*)>$/;
const HAS_LETTER = /\p{L}/u;

const snippet = (code: string) => (code.length > 80 ? `${code.slice(0, 79)}…` : code);

const nonBlank = (s: string | undefined): s is string => typeof s === 'string' && s.trim() !== '';

const NAME_CHANGE: Record<number, [EntryCategory, string]> = {
  320: ['name', 'ctx.cmd.changeName'],
  324: ['nickname', 'ctx.cmd.changeNickname'],
  325: ['description', 'ctx.cmd.changeProfile'],
};

/**
 * 遍历事件指令列表。键使用指令在原始列表中的下标；
 * 回写时通过对象引用定位，插入 / 删除续行不影响其他词条。
 */
export function walkEventList<C>(list: C[], ad: CommandAdapter<C>, info: EventListInfo, outer: WalkContext): void {
  const snapshot = list.slice();
  // 分支栈：每层记录分支头（选择 X 时、条件分支、否则…）的缩进，缩进回到该层或更外层时出栈
  const stack: { indent: number; step: BranchStep }[] = [];
  const choicesAt = new Map<number, string[]>();
  const ifAt = new Map<number, IfInfo>();
  const ctx: WalkContext = {
    finalizers: outer.finalizers,
    emit: (slot) => outer.emit(stack.length ? { ...slot, branch: stack.map((f) => f.step) } : slot),
  };
  const { keyPrefix, label } = info;
  const at = (...parts: ContextPart[]) => [...label, ...parts];
  const collect = (from: number, code: number): C[] => {
    const out: C[] = [];
    for (let j = from; j < snapshot.length && ad.code(snapshot[j]) === code; j++) out.push(snapshot[j]);
    return out;
  };

  for (let i = 0; i < snapshot.length; i++) {
    const c = snapshot[i];
    const code = ad.code(c);
    const key = `${keyPrefix}/${i}`;

    const indent = ad.indent(c);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const step = branchStep(c, code, ad, choicesAt.get(indent), ifAt.get(indent));
    if (step) {
      stack.push({ indent, step });
      if (step.k === 'if') ifAt.set(indent, { type: step.type, args: step.args });
    }
    if (code === 102) {
      const n = ad.arrLen(c, 0);
      choicesAt.set(indent, Array.from({ length: n }, (_, k) => ad.arrStr(c, 0, k) ?? ''));
    }

    switch (code) {
      case 101: {
        const lines = collect(i + 1, 401);
        let part: ContextPart = { k: 'ctx.cmd.showText' };
        if (!info.xpStyle) {
          const face = ad.str(c, 0);
          const speaker = ad.str(c, 4); // MZ 姓名框
          const faceP = nonBlank(face) ? { face, index: Number(ad.param(c, 1) ?? 0) } : null;
          if (nonBlank(speaker)) {
            ctx.emit({ key: `${key}/speaker`, original: speaker, context: at({ k: 'ctx.cmd.nameBox' }), category: 'speaker', danger: false, set: (v) => ad.setStr(c, 4, v) });
          }
          if (faceP && nonBlank(speaker)) part = { k: 'ctx.cmd.showTextFaceSpeaker', p: { ...faceP, speaker } };
          else if (faceP) part = { k: 'ctx.cmd.showTextFace', p: faceP };
          else if (nonBlank(speaker)) part = { k: 'ctx.cmd.showTextSpeaker', p: { speaker } };
        }
        emitLines(list, ad, ctx, { key, context: at(part), category: 'dialogue', danger: false, header: c, headerHoldsFirst: info.xpStyle, lines, lineCode: 401 });
        i += lines.length;
        break;
      }
      case 105: {
        const lines = collect(i + 1, 405);
        emitLines(list, ad, ctx, { key, context: at({ k: 'ctx.cmd.scrollText' }), category: 'scroll', danger: false, header: c, headerHoldsFirst: false, lines, lineCode: 405 });
        i += lines.length;
        break;
      }
      case 355: {
        const lines = collect(i + 1, 655);
        const write = lineWriter(list, ad, c, true, lines, 655);
        const code = [c, ...lines].map((l) => ad.str(l, 0) ?? '').join('\n');
        emitScriptStrings(ctx, {
          code,
          lang: info.scriptLang,
          keyPrefix: `${key}/s/`,
          context: at({ k: 'ctx.cmd.script' }),
          lineNumbers: lines.length > 0,
          apply: (out) => write(out.split('\n')),
        });
        i += lines.length;
        break;
      }
      case 108: {
        // 注释（108 首行 + 408 续行）：常是开发者备注，但有插件会显示其中的文字（如公共事件菜单的说明）。
        // 逐行提取，跳过独占一行的标签，位置说明中注明所在的标签块。
        const lines = [c, ...collect(i + 1, 408)];
        let tag: string | undefined;
        lines.forEach((line, k) => {
          const text = ad.str(line, 0);
          if (typeof text !== 'string') return;
          const trimmed = text.trim();
          const open = OPEN_TAG.exec(trimmed);
          const close = CLOSE_TAG.exec(trimmed);
          if (open || close) {
            tag = open ? open[1] : undefined;
            return;
          }
          if (!HAS_LETTER.test(text)) return;
          ctx.emit({
            key: `${key}/c/${k}`,
            original: text,
            context: at(
              { k: 'ctx.cmd.comment' },
              ...(tag ? [{ k: 'ctx.cmd.commentTag', p: { tag } }] : []),
              ...(lines.length > 1 ? [{ k: 'ctx.line', p: { n: k + 1 } }] : []),
            ),
            category: 'comment',
            danger: true,
            set: (v) => ad.setStr(line, 0, v),
          });
        });
        i += lines.length - 1;
        break;
      }
      case 111: {
        // 条件分支：类型 12 为脚本条件，常见如 $gameVariables.value(2) === "Night"
        const code = ad.param(c, 0) === 12 ? ad.str(c, 1) : undefined;
        if (!nonBlank(code)) break;
        emitScriptStrings(ctx, {
          code,
          lang: info.scriptLang,
          keyPrefix: `${key}/s/`,
          context: at({ k: 'ctx.cmd.conditionScript' }, { k: 'ctx.raw', p: { text: snippet(code) } }),
          lineNumbers: false,
          apply: (out) => ad.setStr(c, 1, out),
        });
        break;
      }
      case 122: {
        // 控制变量：[起始, 结束, 运算, 操作数类型, 脚本]
        const code = info.scriptOperand && ad.param(c, 3) === 4 ? ad.str(c, 4) : undefined;
        if (!nonBlank(code)) break;
        const [from, to] = [ad.param(c, 0), ad.param(c, 1)];
        emitScriptStrings(ctx, {
          code,
          lang: info.scriptLang,
          keyPrefix: `${key}/s/`,
          context: at({ k: 'ctx.cmd.controlVariable', p: { id: from === to ? String(from) : `${String(from)}-${String(to)}` } }, { k: 'ctx.raw', p: { text: snippet(code) } }),
          lineNumbers: false,
          apply: (out) => ad.setStr(c, 4, out),
        });
        break;
      }
      case 102: {
        // 选项译文同步写入对应的「选择 [xx] 时」(402)
        const indent = ad.indent(c);
        const branches: C[] = [];
        for (let j = i + 1; j < snapshot.length; j++) {
          const cj = snapshot[j];
          if (ad.indent(cj) !== indent) continue;
          if (ad.code(cj) === 404) break;
          if (ad.code(cj) === 402) branches.push(cj);
        }
        const n = ad.arrLen(c, 0);
        for (let k = 0; k < n; k++) {
          const text = ad.arrStr(c, 0, k);
          if (!nonBlank(text)) continue;
          ctx.emit({
            key: `${key}/${k}`,
            original: text,
            context: at({ k: 'ctx.cmd.choice', p: { i: k + 1, n } }),
            category: 'choice',
            danger: false,
            set: (v) => {
              ad.setArrStr(c, 0, k, v);
              for (const b of branches) if (ad.param(b, 0) === k && typeof ad.str(b, 1) === 'string') ad.setStr(b, 1, v);
            },
          });
        }
        break;
      }
      case 320:
      case 324:
      case 325: {
        const text = ad.str(c, 1);
        if (!nonBlank(text)) break;
        const [category, k] = NAME_CHANGE[code];
        ctx.emit({ key, original: text, context: at({ k, p: { actor: String(ad.param(c, 0)) } }), category, danger: false, set: (v) => ad.setStr(c, 1, v) });
        break;
      }
      case 356: {
        const text = ad.str(c, 0);
        if (!nonBlank(text)) break;
        ctx.emit({ key, original: text, context: at({ k: 'ctx.cmd.pluginCommand' }), category: 'plugin', danger: true, set: (v) => ad.setStr(c, 0, v) });
        break;
      }
      case 357: {
        // MZ 插件指令：[插件名, 指令名, 显示文本, 参数对象]
        const args = ad.pluginArgs?.(c);
        if (!args) break;
        const cmd: ContextPart = { k: 'ctx.cmd.pluginCommandMZ', p: { plugin: ad.str(c, 0) ?? '', command: ad.str(c, 1) ?? '' } };
        for (const name of Object.keys(args)) {
          const v = args[name];
          if (typeof v !== 'string') continue;
          emitPluginValue(v, `${key}/${name}`, at(cmd, { k: 'ctx.pluginParam', p: { name } }), (nv) => (args[name] = nv), ctx);
        }
        break;
      }
      default:
        break;
    }
  }
}

interface LinesSpec<C> {
  key: string;
  context: ContextPart[];
  category: EntryCategory;
  danger: boolean;
  header: C;
  /** 首行存放在 header 指令中（XP 的 101） */
  headerHoldsFirst: boolean;
  lines: C[];
  lineCode: number;
}

/** 多行文本合并为一个词条，回写时按行数增删续行指令 */
function emitLines<C>(list: C[], ad: CommandAdapter<C>, ctx: WalkContext, spec: LinesSpec<C>): void {
  const { header, headerHoldsFirst } = spec;
  const parts = [...(headerHoldsFirst ? [ad.str(header, 0) ?? ''] : []), ...spec.lines.map((l) => ad.str(l, 0) ?? '')];
  const text = parts.join('\n');
  if (!text.trim()) return;

  const write = lineWriter(list, ad, header, headerHoldsFirst, spec.lines, spec.lineCode);
  ctx.emit({
    key: spec.key,
    original: text,
    context: spec.context,
    category: spec.category,
    danger: spec.danger,
    set: (value) => write(value.replace(/\r\n?/g, '\n').split('\n')),
  });
}

/** 按新的行数写回：首行（可选）写入 header，其余写入续行指令并增删 */
function lineWriter<C>(list: C[], ad: CommandAdapter<C>, header: C, headerHoldsFirst: boolean, lines: C[], lineCode: number) {
  let current = lines.slice();
  return (newLines: string[]) => {
    let rest = newLines;
    if (headerHoldsFirst) {
      ad.setStr(header, 0, newLines[0]);
      rest = newLines.slice(1);
    }
    const n = Math.min(rest.length, current.length);
    for (let k = 0; k < n; k++) ad.setStr(current[k], 0, rest[k]);
    if (rest.length > current.length) {
      const anchor = current.length ? current[current.length - 1] : header;
      const added = rest.slice(current.length).map((t) => ad.makeLine(anchor, lineCode, t));
      list.splice(list.indexOf(anchor) + 1, 0, ...added);
      current = current.concat(added);
    } else if (rest.length < current.length) {
      for (const r of current.slice(rest.length)) {
        const idx = list.indexOf(r);
        if (idx >= 0) list.splice(idx, 1);
      }
      current = current.slice(0, rest.length);
    }
  };
}

interface IfInfo {
  type: number;
  args: (string | number | boolean)[];
}

const BATTLE_RESULT: Record<number, 'win' | 'escape' | 'lose'> = { 601: 'win', 602: 'escape', 603: 'lose' };

/** 只保留基本类型的参数，过长的字符串截断 */
const primitives = (vals: unknown[]) =>
  vals.map((v) => (typeof v === 'string' ? (v.length > 80 ? `${v.slice(0, 79)}…` : v) : typeof v === 'number' || typeof v === 'boolean' ? v : String(v ?? '')));

/** 分支头指令 → 分支步骤；不是分支头时返回 undefined */
function branchStep<C>(c: C, code: number, ad: CommandAdapter<C>, choices: string[] | undefined, lastIf: IfInfo | undefined): BranchStep | undefined {
  switch (code) {
    case 402: {
      const i = Number(ad.param(c, 0) ?? 0);
      return { k: 'choice', i: i + 1, text: choices?.[i] ?? ad.str(c, 1) ?? '' };
    }
    case 403:
      return { k: 'cancel' };
    case 111: {
      const type = Number(ad.param(c, 0) ?? -1);
      const args: unknown[] = [];
      for (let j = 1; j < 6; j++) {
        // Marshal 字符串需经适配器解码
        const v = typeof ad.str(c, j) === 'string' ? ad.str(c, j) : ad.param(c, j);
        if (v === undefined || v === null) break;
        args.push(v);
      }
      return { k: 'if', type, args: primitives(args) };
    }
    case 411:
      return { k: 'else', type: lastIf?.type ?? -1, args: lastIf?.args ?? [] };
    case 601:
    case 602:
    case 603:
      return { k: 'battle', result: BATTLE_RESULT[code] };
    case 112:
      return { k: 'loop' };
    default:
      return undefined;
  }
}
