import type { ContextPart, EntryCategory } from '@gametrans/shared';
import type { Slot } from './types';
import { emitPluginValue } from './plugin-params';

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
}

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
export function walkEventList<C>(list: C[], ad: CommandAdapter<C>, info: EventListInfo, ctx: WalkContext): void {
  const snapshot = list.slice();
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
        emitLines(list, ad, ctx, { key, context: at({ k: 'ctx.cmd.script' }), category: 'script', danger: true, header: c, headerHoldsFirst: true, lines, lineCode: 655 });
        i += lines.length;
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
  /** 首行存放在 header 指令中（XP 的 101、所有引擎的 355） */
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

  let current = spec.lines.slice();
  ctx.emit({
    key: spec.key,
    original: text,
    context: spec.context,
    category: spec.category,
    danger: spec.danger,
    set: (value) => {
      const newLines = value.replace(/\r\n?/g, '\n').split('\n');
      let rest = newLines;
      if (headerHoldsFirst) {
        ad.setStr(header, 0, newLines[0]);
        rest = newLines.slice(1);
      }
      const n = Math.min(rest.length, current.length);
      for (let k = 0; k < n; k++) ad.setStr(current[k], 0, rest[k]);
      if (rest.length > current.length) {
        const anchor = current.length ? current[current.length - 1] : header;
        const added = rest.slice(current.length).map((t) => ad.makeLine(anchor, spec.lineCode, t));
        list.splice(list.indexOf(anchor) + 1, 0, ...added);
        current = current.concat(added);
      } else if (rest.length < current.length) {
        for (const r of current.slice(rest.length)) {
          const idx = list.indexOf(r);
          if (idx >= 0) list.splice(idx, 1);
        }
        current = current.slice(0, rest.length);
      }
    },
  });
}
