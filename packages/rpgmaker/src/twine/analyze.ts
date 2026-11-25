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
  TwinePrefixStat,
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
  // 单个全大写的词（MISC、OK）多半是常量
  if (words.length === 1 && /^[A-Z0-9_]+$/.test(v.replace(/[.!?…]+$/, ''))) return false;
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
  /** 最终作为链接 / 按钮文字显示（推荐分类为「选项」） */
  link?: boolean;
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

  /** 是否为故事中定义的宏（包括与内置宏同名、被作者覆盖的，如 <<do>>） */
  isCustom(name: string) {
    return this.widgets.has(name) || this.scriptMacros.has(name);
  }

  /**
   * 宏 name 的参数在定义中的用法；没有定义时返回 null。
   * path 为 [i] 表示第 i 个参数；[p, i] 表示第 p 个参数（调用方把整个 $args 传进来）的第 i 项。
   */
  usage(name: string, path: number[], consts: Record<number, string> = {}): Usage | null {
    const def = this.widgets.get(name);
    const js = def ? undefined : this.scriptMacros.get(name);
    if (!def && !js) return null;
    const id = `${name}#${path.join('.')}#${JSON.stringify(consts)}`;
    const hit = this.memo.get(id);
    if (hit) return hit;
    const u: Usage = { kinds: new Map(), split: new Set(), whole: false };
    if (!def) {
      if (path.length === 1) scanScript(js!, path[0], u);
      this.memo.set(id, u);
      return u;
    }
    if (this.stack.has(id) || this.stack.size > 8) return u; // 递归调用
    this.stack.add(id);
    try {
      this.scan(def, path, u, consts);
    } finally {
      this.stack.delete(id);
    }
    this.memo.set(id, u);
    return u;
  }

  private scan(def: WidgetDef, path: number[], u: Usage, consts: Record<number, string>) {
    const { body, tokens } = def;
    const assigns = collectAssignments(tokens, body);
    // 调用方传入的字面量参数（如 <<think $args "do">> 的 "do"）：_verb = $args[1] 时 _verb 为常量，用于跳过不会执行的分支
    const constVars = new Map<string, string>();
    for (const [k, v] of Object.entries(consts)) {
      for (const a of assigns) if (new RegExp(`^\\s*[$_]args\\s*\\[\\s*${k}\\s*\\]\\s*$`).test(a.rhs) && a.lhs.startsWith('_')) constVars.set(a.lhs, v);
    }
    let direct: string;
    if (path.length === 1) {
      const i = path[0];
      const slices = [...Array(i + 1).keys()].join('|');
      direct = `(?:[$_]args\\s*\\[\\s*${i}\\s*\\]|[$_]args\\.slice\\(\\s*(?:${slices})\\s*(?:,[^)]*)?\\))`;
    } else {
      // 整个 $args 被传进来：$args[p][i]，或 <<set _in = $args[p]>> 之后的 _in[i]
      const [p, i] = path;
      const arrays = assigns.filter((x) => new RegExp(`^\\s*[$_]args\\s*\\[\\s*${p}\\s*\\]\\s*$`).test(x.rhs) && x.lhs.startsWith('_')).map((x) => esc(x.lhs));
      direct = `(?:[$_]args\\s*\\[\\s*${p}\\s*\\]${arrays.length ? `|(?<![\\w$])(?:${arrays.join('|')})` : ''})\\s*\\[\\s*${i}\\s*\\]`;
    }
    const aliases = deriveAliases(assigns, direct, new Set());
    this.scanTokens(body, tokens, refPattern(direct, aliases), u);
    // 整体传递 $args（如 <<think $args "say">>）：第 i 个参数是被调用宏第 p 个参数的第 i 项
    if (path.length === 1) {
      for (const tok of tokens) {
        if (tok.t !== 'macro' || tok.close || !this.isCustom(tok.name)) continue;
        const parsed = parseMacroArgs(body, tok.argsStart, tok.argsEnd);
        const literals: Record<number, string> = {};
        parsed.forEach((arg, p) => {
          if (arg.t === 'string') literals[p] = unescapeMacroString(body.slice(arg.contentStart, arg.contentEnd));
        });
        parsed.forEach((arg, p) => {
          if (/^[$_]args$/.test(body.slice(arg.start, arg.end))) this.merge(u, this.usage(tok.name, [p, path[0]], literals), body.slice(tok.start, tok.end), tok.name);
        });
      }
    }
    // 临时变量在同一段落中共享：被调用、没有传参的宏（如 <<do_it>>）也可能读取这里设置的别名
    if (aliases.size) this.leak(def, aliases, u, new Set([def]), 0, constVars);
  }

  /** 在被调用的宏中继续追踪临时变量别名 */
  private leak(from: WidgetDef, aliases: Set<string>, u: Usage, seen: Set<WidgetDef>, depth: number, constVars = new Map<string, string>()) {
    if (depth > 3) return;
    for (const tok of liveMacros(from.tokens, from.body, constVars)) {
      const callee = this.widgets.get(tok.name);
      if (!callee || seen.has(callee)) continue;
      seen.add(callee);
      const names = new Set(aliases);
      const derived = deriveAliases(collectAssignments(callee.tokens, callee.body), null, names);
      if (![...derived].some((n) => new RegExp(`(?<![\\w$])${esc(n)}(?![\\w$])`).test(callee.body))) continue;
      const tmp: Usage = { kinds: new Map(), split: new Set(), whole: false };
      this.scanTokens(callee.body, callee.tokens, refPattern(null, derived), tmp);
      for (const [k, e] of tmp.kinds) if (!u.kinds.has(k)) u.kinds.set(k, { ...e, via: e.via ?? tok.name });
      for (const sp of tmp.split) u.split.add(sp);
      if (tmp.link) u.link = true;
      this.leak(callee, derived, u, seen, depth + 1);
    }
  }

  private scanTokens(body: string, tokens: TwToken[], re: RegExp, u: Usage) {
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
    if (kind === 'link') u.link = true;
    if (!u.kinds.has(kind)) u.kinds.set(kind, { kind, code: snippet(code), ...(via ? { via } : {}) });
  }

  /** 宏 macro 的参数文本 args 中 [a, b) 处的一次引用 */
  private classify(u: Usage, macro: string, args: string, a: number, b: number, code: string, argsStart: number, body: string) {
    const before = args.slice(Math.max(0, a - 60), a);
    const after = args.slice(b, b + 80);
    const custom = this.isCustom(macro);
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
    if (CMP_AFTER.test(after) || CMP_BEFORE.test(before)) {
      // 与另一个临时变量比较（如 <<if _txtFail != _txtPass>>，判断两句文字是否相同）不算逻辑用法；
      // 与字符串、故事变量、数值比较才算
      const other = CMP_AFTER.test(after) ? after.replace(CMP_AFTER, '').trimStart() : (/([^\s(]+)\s*$/.exec(before.replace(CMP_BEFORE, '')) ?? [])[1] ?? '';
      if (/^_[\w$]*(?![\w$.(\[])/.test(other) || /(?:^|[^\w$.])_[\w$]+$/.test(other)) return;
      // 与数值比较（数字、方法的返回值如 $hypnoXP.level()、.length）：参数此时是数字，不影响字符串取值
      if (/^-?\d/.test(other) || /\)$/.test(other) || /\.length$/.test(other) || /^[\w$.]*\(/.test(other)) return;
      return this.add(u, 'compare', code);
    }
    if (KEY_CALL.test(before)) return this.add(u, 'key', code);
    if (/\[\s*$/.test(before) && /^\s*\]/.test(after)) return this.add(u, 'key', code);
    // 拼接成另一个临时变量时，只用分隔符连接（<<set _key = passage() + "__" + _x>>）得到的是另一个值，不影响这段文字本身；
    // 拼进路径（"images/" + _x + ".png"）仍为逻辑值
    const setLike = macro === 'set' || macro === 'run' || macro === 'capture';
    const tempTarget = setLike && /(?:^|[,;])\s*_[\w$]*\s*(?:(?<![=!<>])=(?!=)|\bto\b)[^,;]*$/.test(args.slice(0, a));
    const lits = concatLiterals(before, after);
    const keep = (l: string | undefined) => (tempTarget && l !== undefined && !/\p{L}/u.test(l) ? undefined : l);
    // 字符串拼接：紧邻的字面量是标签 / 属性 / 路径时为逻辑值（"<"+_tag+">"、"images/"+_x+".png"）
    const litBefore = keep(lits.litBefore);
    const litAfter = keep(lits.litAfter);
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
    if (!custom && PRINT_MACROS.has(macro)) return this.add(u, 'print', code);
    if (!custom && TARGET_MACROS.has(macro)) return this.add(u, 'target', code);

    // 作为整个参数传给另一个宏
    const parsed = parseMacroArgs(body, argsStart, argsStart + args.length);
    const pos = parsed.findIndex((p) => p.start - argsStart === a && p.end - argsStart === b);
    if (pos < 0) return;
    const rule = custom ? undefined : BUILTIN_RULES.get(macro);
    if (rule) {
      if (rule.args === 'all' || rule.args.includes(pos)) return this.add(u, 'link', code);
      if (LINK_TARGET_MACROS.has(macro)) this.add(u, 'target', code);
      return;
    }
    if (!custom) return;
    this.merge(u, this.usage(macro, [pos]), code, macro);
  }

  /** 把被调用宏中参数的用途并入当前参数 */
  private merge(u: Usage, inner: Usage | null, code: string, macro: string) {
    if (!inner) return;
    for (const s of inner.split) u.split.add(s);
    const v = verdictOf(inner);
    if (v === 'display') {
      if (inner.link) u.link = true;
      return this.add(u, 'call', code, macro);
    }
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

/** 判断 <<if _verb == "say">> 这类条件：变量为已知常量时返回真假，否则返回 null */
function evalCondition(cond: string, constVars: Map<string, string>): boolean | null {
  const m = /^\s*(_[\w$]+)\s*(===?|!==?|\bis\b|\bisnot\b|\beq\b|\bneq\b)\s*(["'])((?:(?!\3).)*)\3\s*$/.exec(cond);
  if (!m || !constVars.has(m[1])) return null;
  const eq = constVars.get(m[1]) === m[4];
  return /^(?:===?|is|eq)$/.test(m[2]) ? eq : !eq;
}

/** 宏调用，跳过按常量判断不会执行的 <<if>> / <<elseif>> / <<else>> 分支 */
function liveMacros(tokens: TwToken[], body: string, constVars: Map<string, string>) {
  const out: Extract<TwToken, { t: 'macro' }>[] = [];
  const frames: { taken: boolean; live: boolean }[] = [];
  const live = () => frames.every((f) => f.live);
  for (const tok of tokens) {
    if (tok.t !== 'macro') continue;
    const cond = body.slice(tok.argsStart, tok.argsEnd);
    if (tok.close) {
      if (tok.name === 'if') frames.pop();
      continue;
    }
    if (tok.name === 'if') {
      const v = constVars.size ? evalCondition(cond, constVars) : null;
      frames.push({ taken: v === true, live: v !== false });
      continue;
    }
    const top = frames[frames.length - 1];
    if (top && tok.name === 'elseif') {
      const v = top.taken ? false : constVars.size ? evalCondition(cond, constVars) : null;
      top.live = v !== false;
      top.taken ||= v === true;
      continue;
    }
    if (top && tok.name === 'else') {
      top.live = !top.taken;
      continue;
    }
    if (live()) out.push(tok);
  }
  return out;
}

/** 紧邻引用的字符串拼接字面量（"lit" + ref、ref + "lit"） */
function concatLiterals(before: string, after: string) {
  return {
    litBefore: /(["'])((?:(?!\1)[^\n])*)\1\s*\+\s*$/.exec(before)?.[2],
    litAfter: /^\s*\+\s*(["'])((?:(?!\1)[^\n])*)\1/.exec(after)?.[2],
  };
}

/** 引用的正则：直接引用（$args[i] 等）或别名 */
function refPattern(direct: string | null, aliases: Set<string>): RegExp {
  const parts = [...(direct ? [direct] : []), ...(aliases.size ? [`(?<![\\w$])(?:${[...aliases].map(esc).join('|')})(?![\\w$])`] : [])];
  return new RegExp(parts.length ? parts.join('|') : '(?!)', 'g');
}

/**
 * 由赋值推导别名（_x = $args[0]、_y = _x.sayOne()），从 seed 开始直到不再增加。
 * 拼接成键的赋值（_key = passage() + "__" + _x）不算别名：结果是另一个值。
 */
function deriveAliases(assigns: { lhs: string; rhs: string }[], direct: string | null, seed: Set<string>): Set<string> {
  const aliases = new Set(seed);
  for (let changed = true; changed; ) {
    changed = false;
    const re = refPattern(direct, aliases);
    for (const a of assigns) {
      if (aliases.has(a.lhs) || !a.lhs.startsWith('_')) continue;
      re.lastIndex = 0;
      for (let m = re.exec(a.rhs); m; m = re.exec(a.rhs)) {
        const { litBefore, litAfter } = concatLiterals(a.rhs.slice(Math.max(0, m.index - 60), m.index), a.rhs.slice(m.index + m[0].length, m.index + m[0].length + 80));
        const keyish = [litBefore, litAfter].some((l) => l !== undefined && l !== '' && !/\s/.test(l));
        if (keyish) continue;
        aliases.add(a.lhs);
        changed = true;
        break;
      }
    }
  }
  return aliases;
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

interface PrefixAcc {
  count: number;
  prose: number;
  samples: string[];
}

/** 选项参数的前缀：response:、set:REPLY:（可以连续多个），前缀由字母开头 */
const PREFIX = /^((?:!?[A-Za-z][\w-]*:)+)([\s\S]*)$/;

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
  const acc = new Map<string, { uses: number; args: ArgAcc[]; prefixes: Map<string, Map<number, PrefixAcc>> }>();
  const widgets = new Map<string, WidgetDef>();
  const scriptMacros = new Map<string, string>();
  const splitMethods = new Map<string, string[]>();
  const keyedVars = new Set<string>();
  const shownVars = new Set<string>();
  const texts: string[] = [];
  const passages: { text: string; tokens: TwToken[] }[] = [];

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
      passages.push({ text: p.text, tokens });
    }
  }

  // 使用次数与参数统计（作者覆盖了内置宏名的，如 <<widget "do">>，也算自定义宏）
  const isCustom = (name: string) => widgets.has(name) || scriptMacros.has(name);
  for (const p of passages) {
    const { tokens } = p;
    for (const tok of tokens) {
      if (tok.t !== 'macro' || tok.close) continue;
      if (!isCustom(tok.name) && (TWINE_BUILTIN_MACROS.has(tok.name) || /^end\w+$/.test(tok.name))) continue;
      const args = parseMacroArgs(p.text, tok.argsStart, tok.argsEnd);
      let a = acc.get(tok.name);
      if (!a) acc.set(tok.name, (a = { uses: 0, args: [], prefixes: new Map() }));
      a.uses++;
      args.slice(0, 16).forEach((arg, i) => {
        const s = (a!.args[i] ??= { strings: 0, prose: 0, bare: 0, values: new Set(), samples: [] });
        if (arg.t === 'string') {
          const v = unescapeMacroString(p.text.slice(arg.contentStart, arg.contentEnd));
          s.strings++;
          const pm = PREFIX.exec(v);
          if (pm) {
            const byIdx = a!.prefixes.get(pm[1]) ?? new Map<number, PrefixAcc>();
            a!.prefixes.set(pm[1], byIdx);
            const pa = byIdx.get(i) ?? { count: 0, prose: 0, samples: [] };
            byIdx.set(i, pa);
            pa.count++;
            if (isProse(pm[2])) {
              pa.prose++;
              if (pa.samples.length < MAX_SAMPLES && !pa.samples.includes(pm[2])) pa.samples.push(pm[2].length > 160 ? `${pm[2].slice(0, 159)}…` : pm[2]);
            }
          }
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

  // 故事变量在别处的用法：$list.includes("…") 为按字符串查找；<<print $x>>、range $x 为输出
  const all = texts.join('\n');
  for (const m of all.matchAll(/\$([\w$]+)\.(?:includes|indexOf|includesAny|includesAll|delete|contains|count)\(\s*(["'`])(?!\2)/g)) keyedVars.add(m[1]);
  // 与空字符串比较是判断是否为空，不算按字符串查找
  for (const m of all.matchAll(/\$([\w$]+)\s*(?:===?|!==?|\bis\b|\bisnot\b|\beq\b)\s*(["'`])(?!\2)/g)) keyedVars.add(m[1]);
  for (const m of all.matchAll(/State\.variables\.([\w$]+)\.(?:includes|indexOf)\(\s*["'`]/g)) keyedVars.add(m[1]);
  for (const m of all.matchAll(/<<(?:print|=|-)\s+\$([\w$]+)|\brange\s+\$([\w$]+)|\$([\w$]+)\.(?:random|first|last|join|pluck|sayOne|sayIt)\(/g)) shownVars.add(m[1] ?? m[2] ?? m[3]);

  const analyzer = new Analyzer(widgets, scriptMacros, splitMethods, keyedVars, shownVars);
  const out: TwineMacroStat[] = [];
  for (const [name, a] of acc) {
    if (!a.args.some((s) => s?.strings)) continue;
    const source: TwineMacroStat['source'] = widgets.has(name) ? 'widget' : scriptMacros.has(name) ? 'script' : 'none';
    const args: TwineArgStat[] = [];
    const linkArgs = new Set<number>();
    a.args.forEach((s, i) => {
      if (!s) return;
      const u = analyzer.usage(name, [i]);
      if (u?.link) linkArgs.add(i);
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
    // 带前缀的文字：只统计不是文字参数的位置；前缀后多数是句子才推荐
    const prefixes: TwinePrefixStat[] = [];
    for (const [prefix, byIdx] of a.prefixes) {
      const st = { prefix, count: 0, prose: 0, samples: [] as string[], recommend: false };
      for (const [i, pa] of byIdx) {
        if (textArgs.includes(i)) continue;
        st.count += pa.count;
        st.prose += pa.prose;
        for (const x of pa.samples) if (st.samples.length < MAX_SAMPLES && !st.samples.includes(x)) st.samples.push(x);
      }
      if (!st.prose) continue;
      // set:变量:值 / push:数组:值：看该变量在别处是被按字符串查找（键）还是被输出
      const target = /^!?[A-Za-z][\w-]*:([A-Za-z_$][\w$]*):$/.exec(prefix)?.[1];
      if (target && keyedVars.has(target)) st.recommend = false;
      else if (target && shownVars.has(target)) st.recommend = true;
      else st.recommend = st.prose >= 2 && st.prose >= st.count * 0.8;
      prefixes.push(st);
    }
    prefixes.sort((x, y) => y.prose - x.prose);
    const prefixList = prefixes.filter((x) => x.recommend).map((x) => x.prefix);
    let suggested: TwineMacroRule | null = null;
    if (!textArgs.length && prefixList.length) suggested = { name, args: [], prefixes: prefixList };
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
      // 文字最终作为链接 / 按钮显示时推荐分类为「选项」
      const choice = textArgs.every((i) => linkArgs.has(i));
      suggested = {
        name,
        args: textArgs,
        ...(sp >= 0 ? { speaker: sp } : {}),
        ...(choice && sp < 0 ? { category: 'choice' as const } : {}),
        ...(split.length ? { split } : {}),
        ...(prefixList.length ? { prefixes: prefixList } : {}),
      };
    }
    // 推荐翻译的参数都由定义判断为显示文字时为高把握；其余无法判断的参数（如 goto:xxx 这类选项）不影响
    const recommended = args.filter((s) => s.recommend);
    const withText = args.filter((s) => s.strings > 0);
    const confident =
      source !== 'none' && (recommended.length ? recommended.every((s) => s.verdict === 'display') : withText.length > 0 && withText.every((s) => s.verdict === 'display' || s.verdict === 'logic'));
    out.push({ name, uses: a.uses, source, args, prefixes, suggested, confidence: confident ? 'high' : 'low' });
  }
  // 推荐的排前面，其次按使用次数
  return out.sort((x, y) => Number(!!y.suggested) - Number(!!x.suggested) || y.uses - x.uses || x.name.localeCompare(y.name));
}
