import {
  DEFAULT_TWINE_MACROS,
  TWINE_BUILTIN_MACROS,
  TwToken,
  TwineArgStat,
  TwineArgVerdict,
  TwineEvidence,
  TwineEvidenceKind,
  TwineMacroRule,
  TwineMacroStat,
  lexSugarCube,
  parseMacroArgs,
  unescapeMacroString,
} from '@gametrans/shared';
import { shouldSkipPassage } from './extract';
import { readStory } from './story';

export type { TwineMacroStat } from '@gametrans/shared';

/**
 * 自定义宏分析：统计故事中内置宏以外的宏，判断每个参数是不是要翻译的显示文字。
 *
 * 宏用 <<widget>> 定义时，按定义中 $args[i] / _args[i]（及其别名）的用法判断：
 * - 显示：<<print>> / <<=>> 输出、直接写在正文中、作为链接文字、传给另一个宏的文字参数
 * - 逻辑值：参与比较、作为键（includes()、下标）、段落名（<<goto>>）、HTML 标签名 / 属性、拼接成路径
 * - 存入变量：再看该变量在故事别处是被输出还是被按字符串查找
 * 用 Macro.add 定义或找不到定义的宏，只能按字符串内容猜测（低把握）。
 */

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
/** 像代码的词：字母与数字相连（room1）、符号、驼峰（noBorder）、CSS（height:100%） */
const CODEISH = /[=<>#;:%{}()[\]$_\\/|]|[a-z][A-Z]|\p{L}\d|\d\p{L}/u;
/** 英语常见虚词 / 代词：样式、选项参数中很少出现 */
const STOPWORDS = new Set(
  'a an the of to in on at by for from with into onto about over under and or but not no is are was were be been am do does did have has had i me my mine you your yours he him his she her hers it its we us our they them their this that these those who what where when why how some any all one'.split(' '),
);

/** 去掉 Twine 标记（宏、变量、HTML）后的文字 */
const stripMarkup = (s: string) =>
  lexSugarCube(s)
    .filter((t) => t.t === 'text' || t.t === 'nl')
    .map((t) => s.slice(t.start, t.end))
    .join(' ');

/** 字符串像不像要翻译的句子或短语 */
export function isProse(raw: string): boolean {
  // 先去掉常见的句子分隔符（"a///b|c"），否则 /// 会被当成斜体标记
  const v = stripMarkup(raw.replace(/\/\/\/|\|/g, ' ')).replace(/\s+/g, ' ').trim();
  if (v.length < 2 || !/\p{L}/u.test(v)) return false;
  if (CJK.test(v)) return true;
  const words = v.split(' ');
  // 句末标点之外的符号视为代码（选项、样式、条件表达式等）
  if (words.some((w) => CODEISH.test(w.replace(/^["'(“‘*]+|[.,!?…:;"')”’*]+$/g, '')))) return false;
  if (/^["'“‘(]?\p{Lu}/u.test(v) || /[.!?…]["'”’)]?$/.test(v)) return true;
  // 小写开头、没有句末标点的短语（如链接文字「a sister of many」）：含常见虚词或至少四个词才算
  return words.length >= 4 || (words.length >= 2 && words.some((w) => STOPWORDS.has(w.toLowerCase().replace(/[^a-z']/g, ''))));
}

// ───────── 宏定义中的用法分析 ─────────

interface WidgetDef {
  body: string;
  tokens: TwToken[];
}

interface Usage {
  kinds: Map<TwineEvidenceKind, TwineEvidence>;
  split: Set<string>;
  /** 参数整体（$args）传给了别处，无法逐个判断 */
  whole: boolean;
}

const LOGIC_KINDS = new Set<TwineEvidenceKind>(['compare', 'key', 'target', 'markup', 'path', 'storedKey']);
const DISPLAY_KINDS = new Set<TwineEvidenceKind>(['print', 'text', 'link', 'call', 'shown']);
const PRINT_MACROS = new Set(['print', '=', '-']);
const TARGET_MACROS = new Set(['goto', 'include', 'display']);
const BUILTIN_RULES = new Map(DEFAULT_TWINE_MACROS.map((r) => [r.name, r]));
/** 链接类宏的其他参数是段落名 */
const LINK_TARGET_MACROS = new Set(['link', 'button', 'linkappend', 'linkprepend', 'linkreplace', 'click', 'choice', 'back', 'return']);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const snippet = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 90 ? `${one.slice(0, 89)}…` : one;
};

/** 比较运算符；「是否存在」的检查（!== undefined、typeof）不算 */
const CMP_AFTER = /^\s*(?:===?|!==?|<=|>=|<(?![<=])|>(?![>=])|\b(?:is|isnot|eq|neq|gt|gte|lt|lte)\b)/;
const CMP_BEFORE = /(?:===?|!==?|<=|>=|(?:^|[^<])<|(?:^|[^>])>|\b(?:is|isnot|eq|neq|gt|gte|lt|lte))\s*$/;
const EXIST_AFTER = /^\s*(?:===?|!==?|\bis\b|\bisnot\b)\s*(?:["']undefined["']|undefined\b|null\b|""|''|false\b|true\b|0\b)/;
const EXIST_BEFORE = /(?:typeof\s+|(?:undefined|null|""|''|false|true)\s*(?:===?|!==?)\s*)$/;
const KEY_CALL = /\.(?:includes|indexOf|lastIndexOf|includesAny|includesAll|delete|deleteAll|contains|has|count|find|findIndex|get|getItem)\(\s*$/;
const STORE_CALL = /([$_][\w$]*(?:\.[\w$]+)*)\.(?:push|pushUnique|unshift|add|set|concat)\(\s*$/;

class Analyzer {
  private memo = new Map<string, Usage>();
  private stack = new Set<string>();

  constructor(
    private readonly widgets: Map<string, WidgetDef>,
    /** Macro.add 定义的宏 → handler 的 JavaScript 源码 */
    private readonly scriptMacros: Map<string, string>,
    private readonly splitMethods: Map<string, string[]>,
    private readonly keyedVars: Set<string>,
    private readonly shownVars: Set<string>,
  ) {}

  /** 宏 name 的第 i 个参数在定义中的用法；没有 <<widget>> 定义时返回 null */
  usage(name: string, i: number): Usage | null {
    const def = this.widgets.get(name);
    const js = def ? undefined : this.scriptMacros.get(name);
    if (!def && !js) return null;
    const id = `${name}#${i}`;
    const hit = this.memo.get(id);
    if (hit) return hit;
    const u: Usage = { kinds: new Map(), split: new Set(), whole: false };
    if (!def) {
      scanScript(js!, i, u);
      this.memo.set(id, u);
      return u;
    }
    if (this.stack.has(id) || this.stack.size > 8) return u; // 递归调用
    this.stack.add(id);
    try {
      this.scan(def, i, u);
    } finally {
      this.stack.delete(id);
    }
    this.memo.set(id, u);
    return u;
  }

  private scan(def: WidgetDef, i: number, u: Usage) {
    const { body, tokens } = def;
    const slices = [...Array(i + 1).keys()].join('|');
    const direct = `(?:[$_]args\\s*\\[\\s*${i}\\s*\\]|[$_]args\\.slice\\(\\s*(?:${slices})\\s*(?:,[^)]*)?\\))`;
    // 别名：<<set _x = $args[0]>>、_arr = $args[0].split("|")、<<for _k, _v range _arr>>、_list.push($args[0])
    const aliases = new Set<string>();
    const refRe = () => new RegExp(`${direct}${aliases.size ? `|(?<![\\w$])(?:${[...aliases].map(esc).join('|')})(?![\\w$])` : ''}`, 'g');
    const assigns = collectAssignments(tokens, body);
    for (let changed = true; changed; ) {
      changed = false;
      const re = refRe();
      for (const a of assigns) {
        if (aliases.has(a.lhs) || !a.lhs.startsWith('_')) continue;
        re.lastIndex = 0;
        if (re.test(a.rhs)) {
          aliases.add(a.lhs);
          changed = true;
        }
      }
    }
    const re = refRe();
    // 整体传递 $args（如 <<think $args "say">>）
    const wholeRe = /[$_]args(?![\w$]|\s*\[|\.slice|\.length)/;

    for (const tok of tokens) {
      const src = body.slice(tok.start, tok.end);
      if (tok.t === 'var') {
        re.lastIndex = 0;
        const m = re.exec(src);
        if (m && m.index === 0) this.add(u, 'text', src);
        continue;
      }
      if (tok.t === 'link') {
        re.lastIndex = 0;
        if (re.test(body.slice(tok.link.labelStart, tok.link.labelEnd))) this.add(u, 'link', src);
        re.lastIndex = 0;
        if (tok.link.form !== 'simple' && re.test(tok.link.target)) this.add(u, 'target', src);
        continue;
      }
      if (tok.t === 'html') {
        re.lastIndex = 0;
        if (re.test(src)) this.add(u, 'markup', src);
        continue;
      }
      if (tok.t === 'raw') {
        if (/\bargs\b/.test(body.slice(tok.contentStart, tok.contentEnd))) u.whole = true;
        continue;
      }
      if (tok.t !== 'macro' || tok.close) continue;
      const args = body.slice(tok.argsStart, tok.argsEnd);
      if (wholeRe.test(args)) u.whole = true;
      re.lastIndex = 0;
      for (let m = re.exec(args); m; m = re.exec(args)) this.classify(u, tok.name, args, m.index, m.index + m[0].length, src, tok.argsStart, body);
    }
  }

  private add(u: Usage, kind: TwineEvidenceKind, code: string, via?: string) {
    if (!u.kinds.has(kind)) u.kinds.set(kind, { kind, code: snippet(code), ...(via ? { via } : {}) });
  }

  /** 宏 macro 的参数文本 args 中 [a, b) 处的一次引用 */
  private classify(u: Usage, macro: string, args: string, a: number, b: number, code: string, argsStart: number, body: string) {
    const before = args.slice(Math.max(0, a - 60), a);
    const after = args.slice(b, b + 80);
    // 赋值的左边（别名本身）
    if ((macro === 'set' || macro === 'capture' || macro === 'run') && /^\s*(?:(?<![=!<>])=(?!=)|\bto\b|[+\-*/]=)/.test(after)) return;
    if (macro === 'for' && /\brange\b/.test(after) && !/\brange\b/.test(before)) return;

    // 分隔符：$args[0].split("|")；.sayOne() 等在 JavaScript 中按分隔符拆分 this 的方法
    const sp = /^\s*(?:\[[^\]\n]*\]\s*)*\.split\(\s*(["'])((?:\\.|(?!\1).)*)\1/.exec(after);
    if (sp && unescapeMacroString(sp[2]).trim()) u.split.add(unescapeMacroString(sp[2]));
    const method = /^\s*(?:\[[^\]\n]*\]\s*)*\.([\w$]+)\(/.exec(after);
    if (method) for (const s of this.splitMethods.get(method[1]) ?? []) u.split.add(s);

    if (EXIST_AFTER.test(after) || EXIST_BEFORE.test(before)) return;
    // _arr.length、_x.includes("a")：比较的是属性或方法的结果，不是这个字符串本身
    if (/^\s*\.length\b/.test(after) || (method && !PRINT_MACROS.has(macro))) return;
    if (CMP_AFTER.test(after) || CMP_BEFORE.test(before)) return this.add(u, 'compare', code);
    if (KEY_CALL.test(before)) return this.add(u, 'key', code);
    if (/\[\s*$/.test(before) && /^\s*\]/.test(after)) return this.add(u, 'key', code);
    // 字符串拼接：紧邻的字面量是标签 / 属性 / 路径时为逻辑值（"<"+_tag+">"、"images/"+_x+".png"）
    const litBefore = /(["'])((?:(?!\1)[^\n])*)\1\s*\+\s*$/.exec(before)?.[2];
    const litAfter = /^\s*\+\s*(["'])((?:(?!\1)[^\n])*)\1/.exec(after)?.[2];
    if ((litBefore !== undefined && /(?:<\/?|=\s*["']?|\bclass\s*=\s*["']?[^"']*)$/.test(litBefore)) || (litAfter !== undefined && /^[^\s<>]*["']/.test(litAfter))) {
      return this.add(u, 'markup', code);
    }
    if (
      (litBefore !== undefined && litBefore !== '' && !/\s/.test(litBefore) && /(?:[/\\]|[\w-]_|[._-])$/.test(litBefore)) ||
      (litAfter !== undefined && /^(?:\.\w{2,5}\b|[/\\])/.test(litAfter))
    ) {
      return this.add(u, 'path', code);
    }
    const store = STORE_CALL.exec(before);
    if (store) return this.stored(u, store[1], code);
    if (macro === 'set' || macro === 'run' || macro === 'capture') {
      const lhs = /(?:^|[,;]\s*)(\$[\w$]+(?:\.[\w$]+)*)\s*(?:(?<![=!<>])=(?!=)|\bto\b)\s*$/.exec(before);
      if (lhs) this.stored(u, lhs[1], code);
      return;
    }
    if (PRINT_MACROS.has(macro)) return this.add(u, 'print', code);
    if (TARGET_MACROS.has(macro)) return this.add(u, 'target', code);

    // 作为整个参数传给另一个宏
    const parsed = parseMacroArgs(body, argsStart, argsStart + args.length);
    const pos = parsed.findIndex((p) => p.start - argsStart === a && p.end - argsStart === b);
    if (pos < 0) return;
    const rule = BUILTIN_RULES.get(macro);
    if (rule) {
      if (rule.args === 'all' || rule.args.includes(pos)) return this.add(u, 'link', code);
      if (LINK_TARGET_MACROS.has(macro)) this.add(u, 'target', code);
      return;
    }
    if (TWINE_BUILTIN_MACROS.has(macro)) return;
    const inner = this.usage(macro, pos);
    if (!inner) return;
    for (const s of inner.split) u.split.add(s);
    const v = verdictOf(inner);
    if (v === 'display') return this.add(u, 'call', code, macro);
    if (v === 'logic') {
      const ev = [...inner.kinds.values()].find((e) => LOGIC_KINDS.has(e.kind))!;
      return this.add(u, ev.kind, code, macro);
    }
    if (v === 'stored') return this.add(u, 'store', code, macro);
    if (inner.whole || inner.kinds.has('script')) this.add(u, 'script', code, macro);
  }

  /** 存入故事变量：看变量在别处是被按字符串查找（逻辑值），还是被输出 */
  private stored(u: Usage, target: string, code: string) {
    if (!target.startsWith('$')) return;
    const name = target.split('.')[0].slice(1);
    if (this.keyedVars.has(name)) return this.add(u, 'storedKey', code);
    if (this.shownVars.has(name)) return this.add(u, 'shown', code);
    this.add(u, 'store', code);
  }
}

/**
 * Macro.add 定义的宏：在 handler 中找 this.args[i] 及其别名（var id = this.args[0], name = id）。
 * 参与比较、拼进 class / 标签名为逻辑值；拼进输出的 HTML 或传给 wiki() / append() 为显示。
 */
function scanScript(js: string, i: number, u: Usage) {
  const add = (kind: TwineEvidenceKind, code: string) => u.kinds.has(kind) || u.kinds.set(kind, { kind, code: snippet(code) });
  const direct = `this\\.args\\s*\\[\\s*${i}\\s*\\]`;
  const aliases = new Set<string>();
  const statements = js.split(/;|\n/).flatMap((st) => splitTopLevel(st));
  const refRe = () => new RegExp(`${direct}${aliases.size ? `|(?<![\\w$.])(?:${[...aliases].map(esc).join('|')})(?![\\w$])` : ''}`, 'g');
  for (let changed = true; changed; ) {
    changed = false;
    const re = refRe();
    for (const st of statements) {
      const m = /^\s*(?:var|let|const)?\s*([A-Za-z_$][\w$]*)\s*(?<![=!<>+\-*/])=(?!=)\s*([\s\S]+)$/.exec(st.replace(/^\s*if\s*\([^)]*\)\s*/, ''));
      if (!m || aliases.has(m[1]) || m[1] === 'output') continue;
      re.lastIndex = 0;
      if (re.test(m[2])) {
        aliases.add(m[1]);
        changed = true;
      }
    }
  }
  if (/this\.args(?!\s*\[|\.length)/.test(js)) u.whole = true;
  const re = refRe();
  for (let m = re.exec(js); m; m = re.exec(js)) {
    const a = m.index;
    const b = a + m[0].length;
    const before = js.slice(Math.max(0, a - 60), a);
    const after = js.slice(b, b + 80);
    const line = js.slice(js.lastIndexOf('\n', a) + 1, js.indexOf('\n', b) < 0 ? js.length : js.indexOf('\n', b));
    if (/^\s*(?<![=!<>])=(?!=)/.test(after)) continue; // 赋值左边
    if (/(?:var|let|const)\s+$/.test(before)) continue;
    if (/^\s*\.length\b/.test(after) || EXIST_AFTER.test(after) || EXIST_BEFORE.test(before)) continue;
    if (CMP_AFTER.test(after) || CMP_BEFORE.test(before)) {
      add('compare', line);
      continue;
    }
    if (KEY_CALL.test(before) || (/\[\s*$/.test(before) && /^\s*\]/.test(after))) {
      add('key', line);
      continue;
    }
    const litBefore = /(["'])((?:(?!\1)[^\n])*)\1\s*\+\s*$/.exec(before)?.[2];
    const litAfter = /^\s*\+\s*(["'])((?:(?!\1)[^\n])*)\1/.exec(after)?.[2];
    if ((litBefore !== undefined && /(?:<\/?|=\s*["']?|\bclass\s*=\s*["']?[^"']*)$/.test(litBefore)) || (litAfter !== undefined && /^[^\s<>]*["']/.test(litAfter))) {
      add('markup', line);
      continue;
    }
    if (litBefore !== undefined || litAfter !== undefined || /(?:\+=|\+)\s*$/.test(before) || /\.(?:wiki|append|text|html|prepend)\(\s*$/.test(before)) add('print', line);
  }
}

function verdictOf(u: Usage): TwineArgVerdict {
  const kinds = [...u.kinds.keys()];
  if (kinds.some((k) => LOGIC_KINDS.has(k))) return 'logic';
  if (kinds.some((k) => DISPLAY_KINDS.has(k))) return 'display';
  if (kinds.includes('store')) return 'stored';
  return 'unknown';
}

/** <<set>> / <<capture>> / <<for>> 中的赋值：左边变量名与右边表达式 */
function collectAssignments(tokens: TwToken[], body: string): { lhs: string; rhs: string }[] {
  const out: { lhs: string; rhs: string }[] = [];
  for (const t of tokens) {
    if (t.t !== 'macro' || t.close) continue;
    const args = body.slice(t.argsStart, t.argsEnd);
    if (t.name === 'set' || t.name === 'run' || t.name === 'capture') {
      for (const part of splitTopLevel(args)) {
        const m = /^\s*([$_][\w$]*)\s*(?:(?<![=!<>+\-*/])=(?!=)|\bto\b|\+=)\s*([\s\S]*)$/.exec(part);
        if (m) out.push({ lhs: m[1], rhs: m[2] });
        // _list.push($args[0])：_list 也是别名
        for (const p of part.matchAll(/(_[\w$]*)\.(?:push|pushUnique|unshift)\(([^)]*)\)/g)) out.push({ lhs: p[1], rhs: p[2] });
      }
    } else if (t.name === 'for') {
      const m = /^\s*(?:(_[\w$]*)\s*,\s*)?(_[\w$]*)\s+range\s+([\s\S]+)$/.exec(args);
      if (m) {
        if (m[1]) out.push({ lhs: m[1], rhs: m[3] });
        out.push({ lhs: m[2], rhs: m[3] });
      }
    }
  }
  return out;
}

/** 按顶层逗号 / 分号拆分表达式（跳过字符串与括号） */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < s.length && s[i] !== ch; i++) if (s[i] === '\\') i++;
    } else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if ((ch === ',' || ch === ';') && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

/** JavaScript 中按分隔符拆分自身的字符串方法：String.prototype.sayOne = function () { this.split("|") … } */
function findSplitMethods(js: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of js.matchAll(/String\.prototype\.([\w$]+)\s*=\s*function\s*\([^)]*\)\s*\{/g)) {
    const body = braceBody(js, m.index! + m[0].length - 1);
    const seps = new Set<string>();
    for (const s of body.matchAll(/\.split\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g)) if (unescapeMacroString(s[2]).trim()) seps.add(unescapeMacroString(s[2]));
    // [a|b] 这类括号内的变体只在局部生效，整句翻译更合适
    if (seps.has('[') || seps.has(']')) {
      out.delete(m[1]);
      continue;
    }
    if (seps.size) out.set(m[1], [...seps]);
  }
  return out;
}

function braceBody(js: string, open: number): string {
  let depth = 0;
  for (let i = open; i < js.length && i < open + 20000; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}' && --depth === 0) return js.slice(open + 1, i);
  }
  return js.slice(open + 1, open + 2000);
}

interface ArgAcc {
  strings: number;
  prose: number;
  bare: number;
  values: Set<string>;
  samples: string[];
}

const MAX_SAMPLES = 5;

/** 统计所有故事文件中的自定义宏，推荐「哪个参数是显示文字、哪个是说话人」 */
export function analyzeTwineMacros(files: { path: string; bytes: Uint8Array }[]): TwineMacroStat[] {
  const acc = new Map<string, { uses: number; args: ArgAcc[] }>();
  const widgets = new Map<string, WidgetDef>();
  const scriptMacros = new Map<string, string>();
  const splitMethods = new Map<string, string[]>();
  const keyedVars = new Set<string>();
  const shownVars = new Set<string>();
  const texts: string[] = [];

  for (const f of files) {
    let story: ReturnType<typeof readStory>['story'];
    try {
      story = readStory(f.path, f.bytes).story;
    } catch {
      continue;
    }
    const scripts = [story.script?.text ?? '', ...story.passages.filter((p) => p.tags.includes('script')).map((p) => p.text)];
    for (const code of scripts) {
      for (const m of code.matchAll(/Macro\.add\(\s*\[?\s*["'`]([\w-]+)["'`]/g)) {
        // handler 的函数体（找不到时取定义之后的一段）
        const from = m.index! + m[0].length;
        const h = /\bhandler\s*(?::\s*function\s*\([^)]*\)|\([^)]*\))\s*\{/.exec(code.slice(from, from + 3000));
        scriptMacros.set(m[1], h ? braceBody(code, from + h.index + h[0].length - 1) : code.slice(from, from + 1500));
      }
      for (const [k, v] of findSplitMethods(code)) splitMethods.set(k, v);
      texts.push(code);
    }

    for (const p of story.passages) {
      if (shouldSkipPassage(p) || p.tags.includes('script')) continue;
      texts.push(p.text);
      const tokens = lexSugarCube(p.text);
      // <<widget "名字">> … <</widget>>
      for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.t !== 'macro' || t.close || t.name !== 'widget') continue;
        const a0 = parseMacroArgs(p.text, t.argsStart, t.argsEnd)[0];
        if (!a0) continue;
        const name = a0.t === 'string' ? unescapeMacroString(p.text.slice(a0.contentStart, a0.contentEnd)) : p.text.slice(a0.start, a0.end);
        const end = tokens.findIndex((x, j) => j > k && x.t === 'macro' && x.close && x.name === 'widget');
        const body = p.text.slice(t.end, end > 0 ? tokens[end].start : p.text.length);
        widgets.set(name, { body, tokens: lexSugarCube(body) });
      }
      for (const tok of tokens) {
        if (tok.t !== 'macro' || tok.close) continue;
        if (TWINE_BUILTIN_MACROS.has(tok.name) || /^end\w+$/.test(tok.name)) continue;
        const args = parseMacroArgs(p.text, tok.argsStart, tok.argsEnd);
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
              if (s.samples.length < MAX_SAMPLES && !s.samples.includes(v)) s.samples.push(v.length > 160 ? `${v.slice(0, 159)}…` : v);
            }
          } else if (arg.t === 'bare') {
            s.bare++;
            if (s.values.size <= 200) s.values.add(p.text.slice(arg.start, arg.end));
          }
        });
      }
    }
  }

  // 故事变量在别处的用法：$list.includes("…") 为按字符串查找；<<print $x>>、range $x 为输出
  const all = texts.join('\n');
  for (const m of all.matchAll(/\$([\w$]+)\.(?:includes|indexOf|includesAny|includesAll|delete|contains|count)\(\s*["'`]/g)) keyedVars.add(m[1]);
  for (const m of all.matchAll(/\$([\w$]+)\s*(?:===?|!==?|\bis\b|\bisnot\b|\beq\b)\s*["'`]/g)) keyedVars.add(m[1]);
  for (const m of all.matchAll(/State\.variables\.([\w$]+)\.(?:includes|indexOf)\(\s*["'`]/g)) keyedVars.add(m[1]);
  for (const m of all.matchAll(/<<(?:print|=|-)\s+\$([\w$]+)|\brange\s+\$([\w$]+)|\$([\w$]+)\.(?:random|first|last|join|pluck|sayOne|sayIt)\(/g)) shownVars.add(m[1] ?? m[2] ?? m[3]);

  const analyzer = new Analyzer(widgets, scriptMacros, splitMethods, keyedVars, shownVars);
  const out: TwineMacroStat[] = [];
  for (const [name, a] of acc) {
    if (!a.args.some((s) => s?.strings)) continue;
    const source: TwineMacroStat['source'] = widgets.has(name) ? 'widget' : scriptMacros.has(name) ? 'script' : 'none';
    const args: TwineArgStat[] = [];
    a.args.forEach((s, i) => {
      if (!s) return;
      const u = analyzer.usage(name, i);
      let verdict: TwineArgVerdict = u ? verdictOf(u) : 'unknown';
      // $args 整体传给 JavaScript 或其他宏（如 <<think $args>>），又没有单独证据时无法判断
      if (u && u.whole && !u.kinds.size) verdict = 'unknown';
      const guess = s.prose >= Math.max(2, a.uses * 0.1) && s.prose >= s.strings * 0.5;
      // 存入变量后不再输出的值多半是键，不推荐
      const recommend = s.strings > 0 && (verdict === 'display' ? s.prose > 0 : verdict === 'unknown' && guess);
      const evidence = u ? [...u.kinds.values()].sort((x, y) => Number(LOGIC_KINDS.has(y.kind)) - Number(LOGIC_KINDS.has(x.kind))).slice(0, 4) : [];
      if (source === 'script' && !evidence.length) evidence.push({ kind: 'script', code: `Macro.add("${name}", …)` });
      const split = verdict === 'display' && u?.split.size ? [...u.split].sort((x, y) => y.length - x.length) : undefined;
      if (s.strings > 0 || s.values.size > 0) {
        args.push({ i, strings: s.strings, prose: s.prose, distinct: s.values.size, samples: s.samples, verdict, evidence, ...(split ? { split } : {}), recommend });
      }
    });
    const textArgs = args.filter((s) => s.recommend).map((s) => s.i);
    let suggested: TwineMacroRule | null = null;
    if (textArgs.length) {
      // 说话人：文字之前、几乎每次都出现、取值种类少的非字符串参数（如 <<say ms "…">> 的 ms）
      // 取值须像代号（ms、mc），不是数字或变量；在宏定义中被直接显示的参数不是代号
      const sp = a.args.findIndex(
        (s, i) =>
          !!s &&
          i < textArgs[0] &&
          s.bare >= a.uses * 0.8 &&
          s.values.size > 0 &&
          s.values.size <= 60 &&
          s.strings <= a.uses * 0.2 &&
          [...s.values].every((v) => /^[A-Za-z][\w-]*$/.test(v)) &&
          args.find((x) => x.i === i)?.verdict !== 'display',
      );
      const split = [...new Set(textArgs.flatMap((i) => args.find((x) => x.i === i)!.split ?? []))];
      suggested = { name, args: textArgs, ...(sp >= 0 ? { speaker: sp } : {}), ...(split.length ? { split } : {}) };
    }
    const withText = args.filter((s) => s.strings > 0);
    const confident = source !== 'none' && withText.length > 0 && withText.every((s) => s.verdict === 'display' || s.verdict === 'logic');
    out.push({ name, uses: a.uses, source, args, suggested, confidence: confident ? 'high' : 'low' });
  }
  // 推荐的排前面，其次按使用次数
  return out.sort((x, y) => Number(!!y.suggested) - Number(!!x.suggested) || y.uses - x.uses || x.name.localeCompare(y.name));
}
