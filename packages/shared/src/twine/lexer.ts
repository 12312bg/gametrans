/**
 * SugarCube 2 段落的词法分析：把段落正文切成「文本」与各类标记。
 * 只做提取翻译所需的粗粒度切分，不求值；无法识别的写法按普通文本处理。
 * 前端（高亮、检查）与解析库（提取、回写）共用。
 */

/** 链接 [[…]] 的结构；下标均为段落内的绝对位置 */
export interface TwLink {
  /** 显示文字的起止（simple 形式即目标本身） */
  labelStart: number;
  labelEnd: number;
  /** 目标段落（或表达式），原样 */
  target: string;
  /** pipe：[[文字|目标]]；arrow：[[文字->目标]]；back：[[目标<-文字]]；simple：[[目标]] */
  form: 'pipe' | 'arrow' | 'back' | 'simple';
}

interface Span {
  start: number;
  end: number;
}

export type TwToken =
  | (Span & { t: 'text' })
  | (Span & { t: 'nl' })
  | (Span & { t: 'macro'; name: string; close: boolean; argsStart: number; argsEnd: number })
  /** <<script>>…<</script>>、<script>…</script>、<style>…</style>：内容原样 */
  | (Span & { t: 'raw'; kind: 'script' | 'style'; contentStart: number; contentEnd: number })
  | (Span & { t: 'link'; link: TwLink })
  | (Span & { t: 'image' })
  | (Span & { t: 'html'; tag: string; close: boolean })
  | (Span & { t: 'var' })
  | (Span & { t: 'comment' })
  | (Span & { t: 'verbatim' })
  /** 格式标记：'' // __ == ^^ ~~ @@、行首标记、续行反斜杠、HTML 实体 */
  | (Span & { t: 'format' });

export type TwTokenType = TwToken['t'];

const MACRO_NAME = /^[A-Za-z][\w-]*|^[=-]/;
const TAG_NAME = /^[A-Za-z][\w:-]*/;
const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[\w$]/;
const ENTITY = /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const FORMAT_PAIRS = ["''", '//', '__', '==', '^^', '~~'];

/** 跳过引号字符串（支持反斜杠转义），返回结束引号之后的位置；未闭合返回 -1 */
export function skipQuoted(text: string, from: number, limit = text.length): number {
  const q = text[from];
  for (let i = from + 1; i < limit; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === q) return i + 1;
  }
  return -1;
}

/** 宏参数结束的 >> 位置：跳过字符串与 [[…]] */
function findMacroEnd(text: string, from: number): number {
  let i = from;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const j = skipQuoted(text, i);
      if (j < 0) break;
      i = j;
    } else if (ch === '[' && text[i + 1] === '[') {
      const j = text.indexOf(']]', i + 2);
      if (j < 0) break;
      i = j + 2;
    } else if (ch === '>' && text[i + 1] === '>') {
      return i;
    } else if (ch === '<' && text[i + 1] === '<') {
      // 宏不能嵌套：遇到下一个 << 说明引号没配对，改用简单查找
      break;
    } else {
      i++;
    }
  }
  const plain = text.indexOf('>>', from);
  return plain;
}

/** 解析 [[…]] 内部：分出显示文字、目标与 setter */
export function parseLinkInner(inner: string, offset: number): TwLink {
  // [[文字|目标][$x to 1]]：setter 从第一个 ][ 开始
  const setterAt = inner.indexOf('][');
  const body = setterAt >= 0 ? inner.slice(0, setterAt) : inner;
  const pipe = body.indexOf('|');
  if (pipe >= 0) return { labelStart: offset, labelEnd: offset + pipe, target: body.slice(pipe + 1), form: 'pipe' };
  const arrow = body.lastIndexOf('->');
  if (arrow >= 0) return { labelStart: offset, labelEnd: offset + arrow, target: body.slice(arrow + 2), form: 'arrow' };
  const back = body.indexOf('<-');
  if (back >= 0) return { labelStart: offset + back + 2, labelEnd: offset + body.length, target: body.slice(0, back), form: 'back' };
  return { labelStart: offset, labelEnd: offset + body.length, target: body, form: 'simple' };
}

const atLineStart = (text: string, i: number) => i === 0 || text[i - 1] === '\n';

export function lexSugarCube(text: string): TwToken[] {
  const out: TwToken[] = [];
  const n = text.length;
  let textStart = -1;
  const flushText = (end: number) => {
    if (textStart >= 0 && end > textStart) out.push({ t: 'text', start: textStart, end });
    textStart = -1;
  };
  const push = (tok: TwToken) => {
    flushText(tok.start);
    out.push(tok);
    return tok.end;
  };

  let i = 0;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '\n') {
      i = push({ t: 'nl', start: i, end: i + 1 });
      continue;
    }

    // 行首标记：标题、列表、引用、分隔线
    if (atLineStart(text, i)) {
      const m = /^(?:!{1,6}|[*#]+(?=[ \t])|>+|-{4,}(?=\n|$))/.exec(text.slice(i, i + 12));
      if (m) {
        i = push({ t: 'format', start: i, end: i + m[0].length });
        continue;
      }
    }

    if (ch === '<') {
      if (next === '<') {
        const tok = lexMacro(text, i);
        if (tok) {
          i = push(tok);
          continue;
        }
      } else if (text.startsWith('<!--', i)) {
        const j = text.indexOf('-->', i + 4);
        if (j >= 0) {
          i = push({ t: 'comment', start: i, end: j + 3 });
          continue;
        }
      } else if (/^<nowiki>/i.test(text.slice(i, i + 8))) {
        const j = text.toLowerCase().indexOf('</nowiki>', i + 8);
        if (j >= 0) {
          i = push({ t: 'verbatim', start: i, end: j + 9 });
          continue;
        }
      } else {
        const tok = lexHtml(text, i);
        if (tok) {
          i = push(tok);
          continue;
        }
      }
    }

    if (ch === '/' && (next === '*' || next === '%')) {
      const j = text.indexOf(next === '*' ? '*/' : '%/', i + 2);
      if (j >= 0) {
        i = push({ t: 'comment', start: i, end: j + 2 });
        continue;
      }
    }

    if (ch === '"' && text.startsWith('"""', i)) {
      const j = text.indexOf('"""', i + 3);
      if (j >= 0) {
        i = push({ t: 'verbatim', start: i, end: j + 3 });
        continue;
      }
    }
    if (ch === '{' && text.startsWith('{{{', i)) {
      const j = text.indexOf('}}}', i + 3);
      if (j >= 0) {
        i = push({ t: 'verbatim', start: i, end: j + 3 });
        continue;
      }
    }

    if (ch === '[') {
      if (next === '[') {
        const j = text.indexOf(']]', i + 2);
        // 链接不跨行
        if (j >= 0 && !text.slice(i + 2, j).includes('\n')) {
          i = push({ t: 'link', start: i, end: j + 2, link: parseLinkInner(text.slice(i + 2, j), i + 2) });
          continue;
        }
      } else {
        const m = /^\[[<>]?img\[/i.exec(text.slice(i, i + 6));
        if (m) {
          const j = text.indexOf(']]', i + m[0].length);
          if (j >= 0 && !text.slice(i, j).includes('\n')) {
            i = push({ t: 'image', start: i, end: j + 2 });
            continue;
          }
        }
      }
    }

    if ((ch === '$' || ch === '_') && IDENT_START.test(next ?? '') && !(i > 0 && IDENT.test(text[i - 1])) && !(ch === '_' && next === '_')) {
      i = push({ t: 'var', start: i, end: scanVariable(text, i) });
      continue;
    }

    if (ch === '@' && next === '@') {
      const m = /^@@[^@;\n]*;/.exec(text.slice(i, i + 200));
      i = push({ t: 'format', start: i, end: i + (m ? m[0].length : 2) });
      continue;
    }
    if (FORMAT_PAIRS.includes(ch + (next ?? '')) && !(ch === '/' && text[i - 1] === ':')) {
      i = push({ t: 'format', start: i, end: i + 2 });
      continue;
    }
    if (ch === '\\' && (next === '\n' || (i > 0 && text[i - 1] === '\n'))) {
      i = push({ t: 'format', start: i, end: i + 1 });
      continue;
    }
    if (ch === '&') {
      const m = ENTITY.exec(text.slice(i, i + 40));
      if (m) {
        i = push({ t: 'format', start: i, end: i + m[0].length });
        continue;
      }
    }

    if (textStart < 0) textStart = i;
    i++;
  }
  flushText(n);
  return out;
}

function scanVariable(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && IDENT.test(text[j])) j++;
  for (;;) {
    if (text[j] === '.' && IDENT_START.test(text[j + 1] ?? '')) {
      j++;
      while (j < text.length && IDENT.test(text[j])) j++;
    } else if (text[j] === '[') {
      const k = text.indexOf(']', j);
      if (k < 0 || text.slice(j, k).includes('\n') || text.slice(j + 1, k).includes('[')) break;
      j = k + 1;
    } else {
      break;
    }
  }
  return j;
}

function lexMacro(text: string, i: number): TwToken | null {
  const close = text[i + 2] === '/';
  const nameAt = i + (close ? 3 : 2);
  const m = MACRO_NAME.exec(text.slice(nameAt, nameAt + 64));
  if (!m) return null;
  const name = m[0];
  const argsStart = nameAt + name.length;
  // 宏名之后必须是空白或 >>
  const after = text[argsStart];
  if (!(after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r')) {
    if (!(name === '=' || name === '-')) return null;
  }
  const end = findMacroEnd(text, argsStart);
  if (end < 0) return null;
  if (!close && name === 'script') {
    const closeTag = /<<\/script\s*>>/g;
    closeTag.lastIndex = end + 2;
    const c = closeTag.exec(text);
    if (c) return { t: 'raw', kind: 'script', start: i, end: c.index + c[0].length, contentStart: end + 2, contentEnd: c.index };
  }
  return { t: 'macro', start: i, end: end + 2, name, close, argsStart, argsEnd: end };
}

function lexHtml(text: string, i: number): TwToken | null {
  const close = text[i + 1] === '/';
  const nameAt = i + (close ? 2 : 1);
  const m = TAG_NAME.exec(text.slice(nameAt, nameAt + 64));
  if (!m) return null;
  const tag = m[0].toLowerCase();
  let j = nameAt + m[0].length;
  const limit = Math.min(text.length, i + 4000);
  while (j < limit) {
    const ch = text[j];
    if (ch === '>') break;
    if (ch === '"' || ch === "'") {
      // 只把属性值当作字符串（= 之后），其余的引号可能是文字中的撇号
      if (/=\s*$/.test(text.slice(Math.max(i, j - 8), j))) {
        const k = skipQuoted(text, j, limit);
        if (k < 0) return null;
        j = k;
        continue;
      }
    }
    if (ch === '<' && text[j + 1] === '<') {
      // 属性中的宏 <<…>>
      const k = findMacroEnd(text, j + 2);
      if (k < 0) return null;
      j = k + 2;
      continue;
    }
    j++;
  }
  if (text[j] !== '>') return null;
  const end = j + 1;
  if (!close && (tag === 'script' || tag === 'style')) {
    const c = text.toLowerCase().indexOf(`</${tag}`, end);
    if (c >= 0) {
      const ce = text.indexOf('>', c);
      if (ce >= 0) return { t: 'raw', kind: tag, start: i, end: ce + 1, contentStart: end, contentEnd: c };
    }
  }
  return { t: 'html', start: i, end, tag, close };
}

/** 宏参数：字符串、链接、图片、表达式（`…`）或其他（变量、数字、关键字等） */
export type TwArg =
  | { t: 'string'; start: number; end: number; quote: string; contentStart: number; contentEnd: number }
  | { t: 'link'; start: number; end: number; link: TwLink }
  | { t: 'image' | 'expr' | 'bare'; start: number; end: number };

/** 按 SugarCube 的规则切分宏参数（空白分隔）；下标为段落内绝对位置 */
export function parseMacroArgs(text: string, argsStart: number, argsEnd: number): TwArg[] {
  const out: TwArg[] = [];
  let i = argsStart;
  while (i < argsEnd) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const j = skipQuoted(text, i, argsEnd);
      if (j > 0) {
        out.push({ t: 'string', start: i, end: j, quote: ch, contentStart: i + 1, contentEnd: j - 1 });
        i = j;
        continue;
      }
    }
    if (ch === '`') {
      const j = skipQuoted(text, i, argsEnd);
      if (j > 0) {
        out.push({ t: 'expr', start: i, end: j });
        i = j;
        continue;
      }
    }
    if (ch === '[' && text[i + 1] === '[') {
      const j = text.indexOf(']]', i + 2);
      if (j >= 0 && j + 2 <= argsEnd) {
        out.push({ t: 'link', start: i, end: j + 2, link: parseLinkInner(text.slice(i + 2, j), i + 2) });
        i = j + 2;
        continue;
      }
    }
    if (ch === '[' && /^\[[<>]?img\[/i.test(text.slice(i, i + 6))) {
      const j = text.indexOf(']]', i);
      if (j >= 0 && j + 2 <= argsEnd) {
        out.push({ t: 'image', start: i, end: j + 2 });
        i = j + 2;
        continue;
      }
    }
    let j = i;
    while (j < argsEnd && !/\s/.test(text[j])) j++;
    out.push({ t: 'bare', start: i, end: j });
    i = j;
  }
  return out;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' };

/** 宏参数字符串的内容 → 显示文本（按 JS 规则去掉转义） */
export function unescapeMacroString(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ESCAPES[e] ?? e;
  });
}

/** 显示文本 → 宏参数字符串的内容（转义反斜杠、定界引号与换行） */
export function escapeMacroString(text: string, quote: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') continue;
    else out += ch;
  }
  return out;
}
