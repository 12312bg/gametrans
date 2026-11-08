import type { ContextPart } from '@gametrans/shared';
import { escapeForQuote, findRubyStrings } from './rgss/ruby-lexer';
import type { WalkContext } from './events';

/** MV/MZ 的事件脚本是 JavaScript，XP/VX/Ace 是 Ruby */
export type ScriptLang = 'js' | 'ruby';

export interface StringLiteral {
  /** 内容起止下标（不含引号） */
  start: number;
  end: number;
  quote: string;
  /** 源码中的原样内容（转义保持不变） */
  content: string;
  line: number;
}

const JS_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * 找出 JavaScript 代码中的字符串字面量（'...'、"..."、不含插值的 `...`），
 * 跳过注释与正则字面量。
 */
export function findJsStrings(code: string): StringLiteral[] {
  const out: StringLiteral[] = [];
  const n = code.length;
  let i = 0;
  let line = 1;
  /** 上一个记号：'' 开头、'w' 标识符或数字、'k' 关键字、'v' 值结尾、其他为运算符 */
  let last = '';

  const skipQuoted = (quote: string, from: number): { end: number; interp: boolean } => {
    let j = from;
    let interp = false;
    while (j < n && code[j] !== quote) {
      const ch = code[j];
      if (ch === '\\') {
        if (code[j + 1] === '\n') line++;
        j += 2;
        continue;
      }
      if (ch === '\n') {
        if (quote !== '`') return { end: -1, interp };
        line++;
      }
      if (quote === '`' && ch === '$' && code[j + 1] === '{') {
        interp = true;
        j = skipBraces(j + 2);
        continue;
      }
      j++;
    }
    return { end: j < n ? j : -1, interp };
  };

  const skipBraces = (from: number): number => {
    let depth = 1;
    let j = from;
    while (j < n && depth > 0) {
      const ch = code[j];
      if (ch === '"' || ch === "'" || ch === '`') {
        const r = skipQuoted(ch, j + 1);
        if (r.end < 0) return n;
        j = r.end + 1;
        continue;
      }
      if (ch === '\n') line++;
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    return j;
  };

  while (i < n) {
    const ch = code[i];
    if (ch === '\n') {
      line++;
      i++;
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++;
    } else if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (code[k] === '\n') line++;
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const startLine = line;
      const { end, interp } = skipQuoted(ch, i + 1);
      if (end < 0) break;
      if (!interp) out.push({ start: i + 1, end, quote: ch, content: code.slice(i + 1, end), line: startLine });
      i = end + 1;
      last = 'v';
    } else if (ch === '/' && last !== 'w' && last !== 'v') {
      // 正则字面量
      let j = i + 1;
      let inClass = false;
      while (j < n && code[j] !== '\n') {
        if (code[j] === '\\') j++;
        else if (code[j] === '[') inClass = true;
        else if (code[j] === ']') inClass = false;
        else if (code[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1;
      while (i < n && /[a-z]/i.test(code[i])) i++;
      last = 'v';
    } else if (/[A-Za-z0-9_$\u0080-￿]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$.\u0080-￿]/.test(code[j])) j++;
      last = JS_KEYWORDS.has(code.slice(i, j)) ? 'k' : 'w';
      i = j;
    } else {
      last = ')]}'.includes(ch) ? 'v' : ch;
      i++;
    }
  }
  return out;
}

/** 写回 JS 字符串：转义未转义的定界引号与换行，模板字符串还要转义 ${ */
export function escapeJsString(text: string, quote: string): string {
  let out = '';
  let backslashes = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      backslashes++;
      out += ch;
      continue;
    }
    const escaped = backslashes % 2 === 1;
    backslashes = 0;
    if (ch === '\n') out += escaped ? 'n' : '\\n';
    else if (ch === '\r') continue;
    else if (!escaped && (ch === quote || (quote === '`' && ch === '$' && text[i + 1] === '{'))) out += `\\${ch}`;
    else out += ch;
  }
  return backslashes % 2 === 1 ? `${out}\\` : out;
}

export function findScriptStrings(code: string, lang: ScriptLang): StringLiteral[] {
  return lang === 'js' ? findJsStrings(code) : findRubyStrings(code);
}

export function escapeScriptString(text: string, quote: string, lang: ScriptLang): string {
  return lang === 'js' ? escapeJsString(text, quote) : escapeForQuote(text, quote as '"' | "'");
}

interface ScriptSpec {
  code: string;
  lang: ScriptLang;
  keyPrefix: string;
  context: ContextPart[];
  /** 多行脚本在位置说明中附上行号 */
  lineNumbers: boolean;
  /** 有译文写入时以新代码调用 */
  apply(code: string): void;
}

/**
 * 脚本中的每个字符串字面量各成一条词条（默认隐藏），代码本身不可编辑；
 * 回写时只替换引号内的内容并按语言转义。
 */
export function emitScriptStrings(walk: WalkContext, spec: ScriptSpec): void {
  const literals = findScriptStrings(spec.code, spec.lang);
  const replacements = new Map<number, string>();
  literals.forEach((lit, n) => {
    if (!lit.content.trim()) return;
    walk.emit({
      key: `${spec.keyPrefix}${n}`,
      original: lit.content,
      context: spec.lineNumbers ? [...spec.context, { k: 'ctx.line', p: { n: lit.line } }] : spec.context,
      category: 'script',
      danger: true,
      set: (v) => replacements.set(n, escapeScriptString(v, lit.quote, spec.lang)),
    });
  });
  walk.finalizers.push(() => {
    if (!replacements.size) return;
    let out = spec.code;
    for (let n = literals.length - 1; n >= 0; n--) {
      const rep = replacements.get(n);
      if (rep !== undefined) out = out.slice(0, literals[n].start) + rep + out.slice(literals[n].end);
    }
    spec.apply(out);
  });
}
