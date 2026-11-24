import { encodeText } from '../mvmz';
import { escapeJsString } from '../script-strings';
import { ParseOptions, ParsedDocument, Slot } from '../types';
import type { PassageSource } from './container';
import { Edit, PassageSlots, emitJsStrings, extractPassage, shouldSkipPassage } from './extract';
import { readStory } from './story';

export { analyzeTwineMacros } from './analyze';
export type { TwineMacroStat } from './analyze';

export { isTweePath } from './story';

/**
 * Twine（SugarCube 2）故事：编译后的 HTML 或 Tweego 源码。
 * 词条键为 passages/<段落名>/list/<序号>（整段事件视图按段落分组）与 script/<序号>（Story JavaScript）。
 * 回写只替换改动的片段，未翻译时与原文件逐字节一致。
 */
export function parseTwine(bytes: Uint8Array, opts: ParseOptions): ParsedDocument {
  const { story, text, bom } = readStory(opts.path, bytes);
  const config = opts.config?.twine;
  const slots: Slot[] = [];
  const groups: { source: PassageSource; edits: Edit[] }[] = [];
  const seen = new Map<string, number>();

  for (const p of story.passages) {
    if (shouldSkipPassage(p)) continue;
    // 段落名理论上唯一；重复时加序号避免键冲突
    const dup = (seen.get(p.name) ?? 0) + 1;
    seen.set(p.name, dup);
    const out: PassageSlots = { slots, edits: [] };
    extractPassage(p, { config, keyPrefix: `passages/${dup > 1 ? `${p.name}#${dup}` : p.name}/list/` }, out);
    groups.push({ source: p, edits: out.edits });
  }

  if (story.script) {
    const src = story.script;
    const edits: Edit[] = [];
    const lines = [0];
    for (let i = 0; i < src.text.length; i++) if (src.text[i] === '\n') lines.push(i + 1);
    const lineOf = (pos: number) => {
      let k = 0;
      while (k + 1 < lines.length && lines[k + 1] <= pos) k++;
      return k + 1;
    };
    let n = 0;
    emitJsStrings(
      src.text,
      0,
      src.text.length,
      (start, end, original, line, quote) =>
        slots.push({
          key: `script/${n++}`,
          original,
          context: [{ k: 'ctx.tw.storyScript', p: { n: line } }],
          category: 'script',
          danger: true,
          set: (v) => edits.push({ start, end, value: escapeJsString(v, quote) }),
        }),
      lineOf,
    );
    groups.push({ source: src, edits });
  }

  return {
    format: story.container === 'twee' ? 'twee' : 'twine-html',
    kind: 'story',
    slots,
    warnings: [],
    serialize: () => {
      const all: { start: number; end: number; value: string }[] = [];
      for (const g of groups) {
        for (const e of g.edits) all.push({ start: g.source.toRaw(e.start), end: g.source.toRaw(e.end), value: g.source.escape(e.value) });
      }
      if (!all.length) return bytes;
      all.sort((a, b) => a.start - b.start);
      const parts: string[] = [];
      let pos = 0;
      for (const e of all) {
        if (e.start < pos) continue; // 防御：重叠的替换只保留第一处
        parts.push(text.slice(pos, e.start), e.value);
        pos = e.end;
      }
      parts.push(text.slice(pos));
      return encodeText(parts.join(''), bom);
    },
  };
}
