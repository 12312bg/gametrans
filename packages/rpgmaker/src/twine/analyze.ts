import { TWINE_BUILTIN_MACROS, TwineMacroRule, lexSugarCube, parseMacroArgs, unescapeMacroString } from '@gametrans/shared';
import { shouldSkipPassage } from './extract';
import { readStory } from './story';

/** 自定义宏的参数统计，用于推荐提取规则 */
export interface TwineMacroStat {
  name: string;
  /** 使用次数 */
  uses: number;
  /** 在故事中定义（<<widget>> 或 Macro.add） */
  defined: boolean;
  args: {
    i: number;
    /** 该位置是字符串的次数 */
    strings: number;
    /** 像是句子（含空格或中日韩文字）的次数 */
    prose: number;
    /** 不同取值数（非字符串，判断是否为说话人代号） */
    distinct: number;
    samples: string[];
  }[];
  /** 推荐的规则；不像显示文字时为 null */
  suggested: TwineMacroRule | null;
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
/** 像代码的词：字母与数字相连（room1）、符号、驼峰（noBorder）、CSS（height:100%） */
const CODEISH = /[=<>#;:%{}()[\]$_\\/|]|[a-z][A-Z]|\p{L}\d|\d\p{L}/u;
const isProse = (s: string) => {
  const v = s.trim();
  if (v.length < 2 || !/\p{L}/u.test(v)) return false;
  if (CJK.test(v)) return true;
  const words = v.split(/\s+/);
  // 句末标点之外的符号视为代码（选项、样式、条件表达式等）
  if (words.some((w) => CODEISH.test(w.replace(/^["'(“‘]+|[.,!?…:;"')”’]+$/g, '')))) return false;
  if (/^["'“‘(]?\p{Lu}/u.test(v) || /[.!?…]["'”’)]?$/.test(v)) return true;
  // 小写开头、没有句末标点的短语（如链接文字「a sister of many」）：含常见虚词或至少四个词才算，
  // 避免把「center special」这类样式参数当成文字
  return words.length >= 4 || (words.length >= 2 && words.some((w) => STOPWORDS.has(w.toLowerCase().replace(/[^a-z']/g, ''))));
};

/** 英语常见虚词 / 代词：样式、选项参数中很少出现 */
const STOPWORDS = new Set(
  'a an the of to in on at by for from with into onto about over under and or but not no is are was were be been am do does did have has had i me my mine you your yours he him his she her hers it its we us our they them their this that these those who what where when why how some any all one'.split(' '),
);

interface ArgAcc {
  strings: number;
  prose: number;
  bare: number;
  values: Set<string>;
  samples: string[];
}

/** 统计所有故事文件中自定义宏的参数，推荐「哪个参数是显示文字、哪个是说话人」 */
export function analyzeTwineMacros(files: { path: string; bytes: Uint8Array }[]): TwineMacroStat[] {
  const acc = new Map<string, { uses: number; args: ArgAcc[] }>();
  const defined = new Set<string>();

  for (const f of files) {
    let story: ReturnType<typeof readStory>['story'];
    try {
      story = readStory(f.path, f.bytes).story;
    } catch {
      continue;
    }
    const scripts = [story.script?.text ?? '', ...story.passages.filter((p) => p.tags.includes('script')).map((p) => p.text)];
    for (const code of scripts) for (const m of code.matchAll(/Macro\.add\(\s*\[?\s*["'`]([\w-]+)["'`]/g)) defined.add(m[1]);

    for (const p of story.passages) {
      if (shouldSkipPassage(p) || p.tags.includes('script')) continue;
      for (const tok of lexSugarCube(p.text)) {
        if (tok.t !== 'macro' || tok.close) continue;
        const args = parseMacroArgs(p.text, tok.argsStart, tok.argsEnd);
        if (tok.name === 'widget' && args[0]) {
          const a0 = args[0];
          defined.add(a0.t === 'string' ? unescapeMacroString(p.text.slice(a0.contentStart, a0.contentEnd)) : p.text.slice(a0.start, a0.end));
        }
        if (TWINE_BUILTIN_MACROS.has(tok.name) || /^end\w+$/.test(tok.name)) continue;
        let a = acc.get(tok.name);
        if (!a) acc.set(tok.name, (a = { uses: 0, args: [] }));
        a.uses++;
        args.slice(0, 16).forEach((arg, i) => {
          const s = (a!.args[i] ??= { strings: 0, prose: 0, bare: 0, values: new Set(), samples: [] });
          if (arg.t === 'string') {
            const v = unescapeMacroString(p.text.slice(arg.contentStart, arg.contentEnd));
            s.strings++;
            if (isProse(v)) {
              s.prose++;
              if (s.samples.length < 3 && !s.samples.includes(v)) s.samples.push(v.length > 120 ? `${v.slice(0, 119)}…` : v);
            }
          } else if (arg.t === 'bare') {
            s.bare++;
            if (s.values.size <= 200) s.values.add(p.text.slice(arg.start, arg.end));
          }
        });
      }
    }
  }

  const out: TwineMacroStat[] = [];
  for (const [name, a] of acc) {
    if (!a.args.some((s) => s?.strings)) continue;
    const args = a.args.map((s, i) => ({ i, strings: s?.strings ?? 0, prose: s?.prose ?? 0, distinct: s?.values.size ?? 0, samples: s?.samples ?? [] }));
    const textArgs = args.filter((s) => s.prose >= Math.max(2, a.uses * 0.1) && s.prose >= s.strings * 0.5).map((s) => s.i);
    let suggested: TwineMacroRule | null = null;
    if (textArgs.length) {
      // 说话人：文字之前、几乎每次都出现、取值种类少的非字符串参数（如 <<say ms "…">> 的 ms）
      const sp = a.args.findIndex((s, i) => !!s && i < textArgs[0] && s.bare >= a.uses * 0.8 && s.values.size > 0 && s.values.size <= 60 && s.strings <= a.uses * 0.2);
      suggested = { name, args: textArgs, ...(sp >= 0 ? { speaker: sp } : {}) };
    }
    out.push({ name, uses: a.uses, defined: defined.has(name), args: args.filter((s) => s.strings > 0 || s.distinct > 0), suggested });
  }
  // 推荐的排前面，其次按使用次数
  return out.sort((x, y) => Number(!!y.suggested) - Number(!!x.suggested) || y.uses - x.uses || x.name.localeCompare(y.name));
}
