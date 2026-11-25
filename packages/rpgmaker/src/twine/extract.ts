import {
  BranchStep,
  ContextPart,
  EntryCategory,
  TWINE_SCRIPT_MACROS,
  TwArg,
  TwLink,
  TwToken,
  TwineConfig,
  TwineMacroRule,
  effectiveTwineRules,
  escapeMacroString,
  lexSugarCube,
  parseMacroArgs,
  twineCodeSpans,
  unescapeMacroString,
} from '@gametrans/shared';
import { escapeJsString, findJsStrings } from '../script-strings';
import type { Slot } from '../types';
import type { PassageSource } from './container';

/** 段落内的一处替换（正文下标） */
export interface Edit {
  start: number;
  end: number;
  value: string;
}

/** 提取结果：词条 + 写回时收集到的替换 */
export interface PassageSlots {
  slots: Slot[];
  edits: Edit[];
}

/** 显示在界面上的特殊段落（菜单、标题栏等），归为「系统」分类 */
const SYSTEM_PASSAGES = new Set(['StoryCaption', 'StoryMenu', 'StoryBanner', 'StorySubtitle', 'StoryAuthor', 'StoryShare', 'StoryInterface', 'PassageHeader', 'PassageFooter']);
/** 不提取的段落：元数据、样式、图片 */
const SKIP_PASSAGES = new Set(['StoryData', 'StoryTitle', 'StorySettings', 'StoryIncludes']);
const SKIP_TAGS = new Set(['stylesheet', 'Twine.image', 'Twine.private', 'annotation']);

/** 会把同一行文字断开的块级 HTML 标签 */
const BLOCK_TAGS = new Set([
  'div', 'p', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'center', 'form', 'fieldset',
  'audio', 'video', 'source', 'iframe', 'canvas', 'svg', 'figure', 'figcaption', 'details', 'summary', 'button', 'select', 'option',
  'textarea', 'input', 'html', 'body', 'head', 'caption',
]);

/** 没有闭标签的 HTML 元素 */
const VOID_TAGS = new Set(['br', 'img', 'hr', 'wbr', 'input', 'meta', 'link', 'source', 'area', 'col', 'embed', 'track']);

/** 输出表达式的宏 */
const PRINT_MACROS = new Set(['print', '=', '-']);

/** 不显示为分支的容器宏 */
const QUIET_CONTAINERS = new Set(['nobr', 'silently', 'capture', 'type', 'do', 'linkify', 'emph', 'script']);
/** 同一容器内的分段宏 → 所属容器 */
const SUBSIDIARY: Record<string, string> = { elseif: 'if', else: 'if', case: 'switch', default: 'switch', next: 'timed' };

const HAS_WORD = /[\p{L}\p{N}]/u;
const truncate = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface PassageOptions {
  config?: TwineConfig | null;
  keyPrefix: string;
}

interface Frame {
  group: string;
  /** 容器开头宏的参数（else 时显示对应的条件） */
  head: string;
  step: BranchStep;
  quiet: boolean;
}

export function passageContext(p: PassageSource): ContextPart {
  return p.tags.length ? { k: 'ctx.tw.passageTags', p: { name: p.name, tags: p.tags.join(' ') } } : { k: 'ctx.tw.passage', p: { name: p.name } };
}

export const shouldSkipPassage = (p: PassageSource) => SKIP_PASSAGES.has(p.name) || p.tags.some((t) => SKIP_TAGS.has(t));

/** 提取一个段落的词条 */
export function extractPassage(p: PassageSource, opts: PassageOptions, out: PassageSlots): void {
  const { text } = p;
  const passage = passageContext(p);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  let n = 0;
  const stack: Frame[] = [];
  const branch = () => {
    const steps = stack.filter((f) => !f.quiet).map((f) => f.step);
    return steps.length ? { branch: steps } : {};
  };
  const emit = (start: number, end: number, original: string, detail: ContextPart, category: EntryCategory, danger: boolean, write: (v: string) => string) => {
    out.slots.push({
      key: `${opts.keyPrefix}${n++}`,
      original,
      context: [passage, detail],
      category,
      danger,
      ...branch(),
      set: (v) => out.edits.push({ start, end, value: write(v) }),
    });
  };
  const ui = SYSTEM_PASSAGES.has(p.name);
  const widget = p.tags.includes('widget');
  const textCategory: EntryCategory = ui ? 'ui' : 'passage';

  // 脚本段落（twee 中带 script 标签）：只提取字符串
  if (p.tags.includes('script')) {
    emitJsStrings(text, 0, text.length, (s, e, o, line, quote) => emit(s, e, o, { k: 'ctx.tw.script', p: { n: line } }, 'script', true, (v) => escapeJsString(v, quote)), lineOf);
    return;
  }

  const tokens = lexSugarCube(text);
  const rules = effectiveTwineRules(opts.config);
  const openNames = new Set<string>();
  const closeNames = new Set<string>();
  for (const t of tokens) if (t.t === 'macro') (t.close ? closeNames : openNames).add(t.name);
  // 旧写法 <<endif>> 等同 <</if>>
  const closeOf = (t: Extract<TwToken, { t: 'macro' }>): string | null => {
    if (t.close) return t.name;
    const m = /^end(\w+)$/.exec(t.name);
    return m && openNames.has(m[1]) && !rules.has(t.name) ? m[1] : null;
  };
  const isContainer = (name: string) => closeNames.has(name) || openNames.has(`end${name}`);

  let run: TwToken[] = [];
  const flush = () => {
    if (run.length) emitRun(run);
    run = [];
  };

  const emitLink = (link: TwLink, line: number, category: EntryCategory) => {
    const label = text.slice(link.labelStart, link.labelEnd);
    if (!HAS_WORD.test(label)) return;
    const simple = link.form === 'simple';
    emit(link.labelStart, link.labelEnd, label, { k: 'ctx.tw.link', p: { target: truncate(link.target), n: line } }, category, false, (v) =>
      simple ? `${v}|${link.target}` : v,
    );
  };

  const emitRun = (items: TwToken[]) => {
    // 去掉首尾的空白、注释、行首标记、<br> 等单标签与不成对的 HTML 标签；
    // 宏与变量保留在词条中（如「<<name>> 走了进来」），译文可以调整位置
    const isBlank = (t: TwToken) => t.t === 'text' && text.slice(t.start, t.end).trim() === '';
    const tagCount = (from: number, to: number, tag: string, close: boolean) =>
      items.slice(from, to + 1).filter((t) => t.t === 'html' && t.tag === tag && t.close === close).length;
    const trimmable = (t: TwToken, at: number, from: number, to: number) => {
      if (isBlank(t) || t.t === 'comment' || t.t === 'format') return true;
      if (t.t !== 'html') return false;
      if (VOID_TAGS.has(t.tag)) return true;
      // 开头的开标签、结尾的闭标签：在剩余部分中没有配对时去掉
      return at === from ? t.close || !tagCount(from, to, t.tag, true) : !t.close || !tagCount(from, to, t.tag, false);
    };
    let a = 0;
    let b = items.length - 1;
    for (let changed = true; changed && a <= b; ) {
      changed = false;
      while (a <= b && trimmable(items[a], a, a, b)) (a++, (changed = true));
      while (b >= a && trimmable(items[b], b, a, b)) (b--, (changed = true));
      // 包住整行的成对标签（<c>…</c>）
      const [x, y] = [items[a], items[b]];
      if (a < b && x.t === 'html' && y.t === 'html' && !x.close && y.close && x.tag === y.tag && !tagCount(a + 1, b - 1, x.tag, true) && !tagCount(a + 1, b - 1, x.tag, false)) {
        a++;
        b--;
        changed = true;
      }
    }
    if (a > b) return;
    const body = items.slice(a, b + 1);
    const hasWord = body.some((t) => (t.t === 'text' ? HAS_WORD.test(text.slice(t.start, t.end)) : t.t === 'link' && HAS_WORD.test(text.slice(t.link.labelStart, t.link.labelEnd))));
    if (!hasWord) return;
    const line = lineOf(body[0].start);
    if (body.length === 1 && body[0].t === 'link') return emitLink(body[0].link, line, ui ? 'ui' : 'link');

    let start = body[0].start;
    let end = body[body.length - 1].end;
    if (body[0].t === 'text') start += text.slice(start, body[0].end).length - text.slice(start, body[0].end).trimStart().length;
    const last = body[body.length - 1];
    if (last.t === 'text') end -= text.slice(last.start, end).length - text.slice(last.start, end).trimEnd().length;
    // [[目标]] 在词条中写成 [[目标|目标]]，显示文字可以单独翻译
    let original = '';
    let pos = start;
    for (const t of body) {
      if (t.t !== 'link' || t.link.form !== 'simple') continue;
      original += text.slice(pos, t.link.labelEnd) + `|${t.link.target}`;
      pos = t.link.labelEnd;
    }
    original += text.slice(pos, end);
    emit(start, end, original, { k: 'ctx.tw.text', p: { n: line } }, textCategory, false, (v) => v);
  };

  const emitRuleArgs = (tok: Extract<TwToken, { t: 'macro' }>, rule: TwineMacroRule) => {
    const args = parseMacroArgs(text, tok.argsStart, tok.argsEnd);
    const line = lineOf(tok.start);
    // 未指定分类：有说话人参数的为对话，否则为正文；界面段落中的一律为界面文字
    const category: EntryCategory = ui ? 'ui' : rule.category ?? (rule.speaker !== undefined ? 'dialogue' : 'passage');
    let speaker: string | undefined;
    if (rule.speaker !== undefined && args[rule.speaker]) speaker = argText(text, args[rule.speaker]);
    const indexes = rule.args === 'all' ? args.map((_, i) => i) : [...rule.args];
    // 说话人写成字符串时（如 <<say "Unknown man" "…">>）也是显示文字
    const sp = rule.speaker !== undefined ? args[rule.speaker] : undefined;
    if (sp?.t === 'string' && !indexes.includes(rule.speaker!)) indexes.push(rule.speaker!);
    indexes.sort((x, y) => x - y);
    for (const i of indexes) {
      const arg = args[i];
      if (!arg || (i === rule.speaker && arg.t !== 'string')) continue;
      const cat: EntryCategory = i === rule.speaker ? 'speaker' : category;
      if (arg.t === 'link') {
        const label = text.slice(arg.link.labelStart, arg.link.labelEnd);
        if (!HAS_WORD.test(label)) continue;
        const simple = arg.link.form === 'simple';
        const target = arg.link.target;
        emit(arg.link.labelStart, arg.link.labelEnd, label, detailOf(tok.name, i, line, speaker), cat, false, (v) => (simple ? `${v}|${target}` : v));
      } else if (arg.t === 'string') {
        const value = unescapeMacroString(text.slice(arg.contentStart, arg.contentEnd));
        emitString(arg, '', value, detailOf(tok.name, i, line, i === rule.speaker ? undefined : speaker), cat, i === rule.speaker ? undefined : rule.split);
      }
    }
    // 其他位置带前缀的文字（如 "response:台词|台词"）：提取前缀之后的部分，写回时保留前缀
    const prefixes = [...(rule.prefixes ?? [])].sort((x, y) => y.length - x.length);
    if (!prefixes.length) return;
    args.forEach((arg, i) => {
      if (arg.t !== 'string' || indexes.includes(i) || i === rule.speaker) return;
      const value = unescapeMacroString(text.slice(arg.contentStart, arg.contentEnd));
      const prefix = prefixes.find((x) => value.toLowerCase().startsWith(x.toLowerCase()));
      if (!prefix) return;
      const head = value.slice(0, prefix.length);
      emitString(arg, head, value.slice(prefix.length), { k: 'ctx.tw.prefixed', p: { macro: tok.name, i, prefix: head, n: line } }, ui ? 'ui' : 'dialogue', rule.split);
    });
  };

  /** 宏参数中的字符串：head 为保留不译的前缀；有分隔符时拆成多条词条 */
  const emitString = (arg: Extract<TwArg, { t: 'string' }>, head: string, value: string, detail: ContextPart, cat: EntryCategory, split: string[] | undefined) => {
    if (!HAS_WORD.test(stripMarkup(value))) return;
    const quote = arg.quote;
    const parts = split?.length ? splitParts(value, split) : null;
    if (!parts || parts.length === 1) {
      emit(arg.contentStart, arg.contentEnd, value, detail, cat, false, (v) => escapeMacroString(head + v, quote));
      return;
    }
    // 按分隔符拆成多条词条：每条写回时更新对应片段，整个字符串用原分隔符拼接（同一位置以最后一次写入为准）
    parts.forEach((part, k) => {
      if (part.sep || !HAS_WORD.test(stripMarkup(part.text))) return;
      const lead = /^\s*/.exec(part.text)![0];
      const trail = /\s*$/.exec(part.text.slice(lead.length))![0];
      emit(arg.contentStart, arg.contentEnd, part.text.trim(), detail, cat, false, (v) => {
        parts[k] = { text: lead + v + trail };
        return escapeMacroString(head + parts.map((x) => x.text).join(''), quote);
      });
    });
  };

  /**
   * <<print>> / <<=>> / <<->> 中的字符串：直接输出到页面、位于 HTML 标签之外且含文字的（如 "<div>" + x + " skill check passed</div>"）
   * 作为可见词条（宏定义中为界面文字）；标签内的属性、函数参数、下标、比较值仍按脚本字符串处理（默认隐藏）
   */
  const emitPrint = (from: number, to: number) => {
    const code = text.slice(from, to);
    let inTag = false;
    const literals = findJsStrings(code);
    // 拼接 Twine 代码的表达式（"<<do \"" + x + "\" CHOICE:…>>"）：整段按脚本处理
    const isBroken = (value: string) => {
      const toks = lexSugarCube(value);
      const count = (re: RegExp) => (value.match(re) ?? []).length;
      const macros = toks.filter((t) => t.t === 'macro' || t.t === 'raw').length;
      const links = toks.filter((t) => t.t === 'link' || t.t === 'image').length;
      return count(/<</g) !== macros || count(/>>/g) !== macros || count(/\[\[|\[[<>]?img\[/gi) !== links || count(/\]\]/g) !== links;
    };
    const codeBuilding = literals.some((lit) => isBroken(unescapeMacroString(lit.content)));
    for (const lit of literals) {
      const start = from + lit.start;
      const end = from + lit.end;
      const before = code.slice(Math.max(0, lit.start - 40), lit.start - 1);
      const after = code.slice(lit.end + 1, lit.end + 40);
      const value = unescapeMacroString(lit.content);
      // 按输出顺序跟踪是否处在 HTML 标签内，取出标签外的文字；从标签中间开始的片段（"' >email</a>"）译者难以保留，按脚本处理
      const startsInTag = inTag;
      let visible = '';
      for (let k = 0; k < value.length; k++) {
        const ch = value[k];
        if (!inTag && ch === '<' && /[A-Za-z/!]/.test(value[k + 1] ?? '')) inTag = true;
        else if (inTag && ch === '>') inTag = false;
        else if (!inTag) visible += ch;
      }
      const asArgument = /[([,]\s*$/.test(before) && !/\+\s*$/.test(before);
      const compared = /(?:===?|!==?|\bis\b|\bisnot\b|\beq\b|\bneq\b)\s*$/.test(before) || /^\s*(?:===?|!==?|\bis\b|\bisnot\b|\beq\b|\bneq\b)/.test(after);
      const method = /^\s*\.(?!sayOne\b|sayIt\b)[\w$]+\(/.test(after);
      if (!lit.content.trim() || !HAS_WORD.test(lit.content)) continue;
      const words = stripMarkup(visible).replace(/[^\p{L}\p{N}]/gu, '');
      // 拼接 Twine 代码的片段（"<<do \"…" 、"[img[" + x + "]]"）：标记不完整，按脚本处理
      const broken = codeBuilding;
      if (asArgument || compared || method || startsInTag || broken || words.length < 2) {
        emit(start, end, lit.content, { k: 'ctx.tw.script', p: { n: lineOf(start) } }, 'script', true, (v) => escapeJsString(v, lit.quote));
        continue;
      }
      emit(start, end, value, { k: 'ctx.tw.print', p: { n: lineOf(start) } }, widget || ui ? 'ui' : textCategory, false, (v) => escapeMacroString(v, lit.quote));
    }
  };

  const emitScript = (from: number, to: number) =>
    emitJsStrings(text, from, to, (s, e, o, line, quote) => emit(s, e, o, { k: 'ctx.tw.script', p: { n: line } }, 'script', true, (v) => escapeJsString(v, quote)), lineOf);

  for (const tok of tokens) {
    switch (tok.t) {
      case 'nl':
        flush();
        break;
      case 'raw':
        flush();
        if (tok.kind === 'script') emitScript(tok.contentStart, tok.contentEnd);
        break;
      case 'html':
        if (BLOCK_TAGS.has(tok.tag)) flush();
        else run.push(tok);
        break;
      case 'macro': {
        const closing = closeOf(tok);
        if (closing !== null) {
          flush();
          for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k].group === closing) {
              stack.length = k;
              break;
            }
          }
          break;
        }
        const sub = SUBSIDIARY[tok.name];
        const top = stack[stack.length - 1];
        if (sub && top?.group === sub) {
          flush();
          const args = truncate(text.slice(tok.argsStart, tok.argsEnd).trim());
          const otherwise = (tok.name === 'else' || tok.name === 'default') && top.head;
          top.step = { k: 'macro', name: tok.name, args, ...(otherwise ? { of: top.head } : {}) };
          break;
        }
        const rule = rules.get(tok.name);
        const scriptLike = TWINE_SCRIPT_MACROS.has(tok.name) && /["'`]/.test(text.slice(tok.argsStart, tok.argsEnd));
        const container = isContainer(tok.name);
        if (rule || scriptLike || container) flush();
        if (rule) emitRuleArgs(tok, rule);
        else if (scriptLike) (PRINT_MACROS.has(tok.name) ? emitPrint(tok.argsStart, tok.argsEnd) : emitScript(tok.argsStart, tok.argsEnd));
        if (container) {
          const args = truncate(text.slice(tok.argsStart, tok.argsEnd).trim());
          stack.push({ group: tok.name, head: args, step: { k: 'macro', name: tok.name, args }, quiet: QUIET_CONTAINERS.has(tok.name) });
        } else if (!rule && !scriptLike) {
          run.push(tok);
        }
        break;
      }
      default:
        run.push(tok);
    }
  }
  flush();
}

/** 按分隔符拆分（长的优先），分隔符本身也作为片段保留 */
function splitParts(value: string, seps: string[]): { text: string; sep?: boolean }[] {
  const re = new RegExp(`(${[...seps].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
  return value.split(re).map((text, k) => (k % 2 ? { text, sep: true } : { text }));
}

/** 去掉标记后的文字（判断是否有需要翻译的内容） */
function stripMarkup(s: string): string {
  let out = '';
  let pos = 0;
  for (const r of twineCodeSpans(s)) {
    out += s.slice(pos, r.start);
    pos = r.end;
  }
  return out + s.slice(pos);
}

function detailOf(macro: string, i: number, line: number, speaker?: string): ContextPart {
  return speaker ? { k: 'ctx.tw.say', p: { macro, speaker, n: line } } : { k: 'ctx.tw.arg', p: { macro, i, n: line } };
}

/** 参数的显示值：字符串去掉引号与转义，其余原样 */
function argText(text: string, arg: TwArg): string {
  if (arg.t === 'string') return unescapeMacroString(text.slice(arg.contentStart, arg.contentEnd));
  return text.slice(arg.start, arg.end);
}

/** 代码片段中的字符串字面量（跳过没有文字的字符串） */
export function emitJsStrings(
  text: string,
  from: number,
  to: number,
  emit: (start: number, end: number, original: string, line: number, quote: string) => void,
  lineOf: (pos: number) => number,
) {
  for (const lit of findJsStrings(text.slice(from, to))) {
    if (!HAS_WORD.test(lit.content) || !lit.content.trim()) continue;
    emit(from + lit.start, from + lit.end, lit.content, lineOf(from + lit.start), lit.quote);
  }
}
