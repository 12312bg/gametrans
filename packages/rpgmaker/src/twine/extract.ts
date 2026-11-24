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
  const textCategory: EntryCategory = SYSTEM_PASSAGES.has(p.name) ? 'system' : 'dialogue';

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
    if (body.length === 1 && body[0].t === 'link') return emitLink(body[0].link, line, 'choice');

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
    const category: EntryCategory = rule.category ?? 'dialogue';
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
        if (!HAS_WORD.test(stripMarkup(value))) continue;
        const quote = arg.quote;
        emit(arg.contentStart, arg.contentEnd, value, detailOf(tok.name, i, line, i === rule.speaker ? undefined : speaker), cat, false, (v) => escapeMacroString(v, quote));
      }
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
        else if (scriptLike) emitScript(tok.argsStart, tok.argsEnd);
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
