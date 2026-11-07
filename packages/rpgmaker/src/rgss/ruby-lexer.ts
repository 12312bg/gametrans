/**
 * 轻量 Ruby 词法扫描：只找出脚本中的字符串字面量（"..." 与 '...'）。
 * 能正确跳过注释、=begin/=end、正则、%字面量、heredoc、字符字面量 ?x、$" 等全局变量、
 * 以及双引号中的 #{...} 插值，避免把它们误判为字符串边界。
 */
export interface RubyStringLiteral {
  /** 内容起始下标（不含引号） */
  start: number;
  /** 内容结束下标（不含引号） */
  end: number;
  quote: '"' | "'";
  /** 源码中的原样内容（转义保持不变） */
  content: string;
  /** 所在行号（从 1 开始） */
  line: number;
}

const KEYWORDS = new Set([
  'if', 'elsif', 'unless', 'while', 'until', 'when', 'case', 'and', 'or', 'not', 'return', 'then', 'do',
  'puts', 'print', 'p', 'raise', 'yield', 'in', 'else', 'begin', 'rescue', 'ensure',
]);

const isIdentStart = (c: string) => /[A-Za-z_\u0080-￿]/.test(c);
const isIdentChar = (c: string) => /[A-Za-z0-9_\u0080-￿]/.test(c);
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };

export function findRubyStrings(code: string): RubyStringLiteral[] {
  const out: RubyStringLiteral[] = [];
  const n = code.length;
  let i = 0;
  /** 上一个有意义的记号：'' 行首/开头, 'w' 标识符, 'k' 关键字, 'n' 数字, 'v' 值结尾（) ] } 字符串）, 其他为运算符字符 */
  let last = '';
  let spaceBefore = false;
  const heredocs: { id: string; indent: boolean }[] = [];

  const lineStarts = [0];
  for (let k = 0; k < n; k++) if (code.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const valueEnded = () => last === 'w' || last === 'n' || last === 'v';
  const exprStart = () => !valueEnded();

  /** 跳过双引号类字面量，返回结束引号的下标 */
  const skipDouble = (from: number, close: string, open?: string): number => {
    let depth = 0;
    let j = from;
    while (j < n) {
      const c = code[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '#' && code[j + 1] === '{') {
        j = skipInterpolation(j + 2);
        continue;
      }
      if (open && c === open) depth++;
      else if (c === close) {
        if (depth === 0) return j;
        depth--;
      }
      j++;
    }
    return n;
  };

  const skipSingle = (from: number, close: string, open?: string): number => {
    let depth = 0;
    let j = from;
    while (j < n) {
      const c = code[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (open && c === open) depth++;
      else if (c === close) {
        if (depth === 0) return j;
        depth--;
      }
      j++;
    }
    return n;
  };

  /** 跳过 #{ ... }，返回 } 之后的下标 */
  const skipInterpolation = (from: number): number => {
    let depth = 1;
    let j = from;
    while (j < n) {
      const c = code[j];
      if (c === '"' || c === '`') {
        j = skipDouble(j + 1, c) + 1;
        continue;
      }
      if (c === "'") {
        j = skipSingle(j + 1, "'") + 1;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return j + 1;
      }
      j++;
    }
    return n;
  };

  const skipHeredocBodies = (from: number): number => {
    let j = from;
    while (heredocs.length && j < n) {
      const { id, indent } = heredocs[0];
      const eol = code.indexOf('\n', j);
      const lineEnd = eol < 0 ? n : eol;
      const line = code.slice(j, lineEnd).replace(/\r$/, '');
      if ((indent ? line.trim() : line) === id) heredocs.shift();
      j = lineEnd + 1;
    }
    return j;
  };

  let lineStart = true;
  while (i < n) {
    const c = code[i];

    if (c === '\n') {
      i++;
      if (heredocs.length) i = skipHeredocBodies(i);
      lineStart = true;
      spaceBefore = true;
      last = '';
      continue;
    }
    if (lineStart) {
      if (code.startsWith('=begin', i) && /\s|$/.test(code[i + 6] ?? '')) {
        const endIdx = code.indexOf('\n=end', i);
        if (endIdx < 0) break;
        const after = code.indexOf('\n', endIdx + 1);
        i = after < 0 ? n : after;
        continue;
      }
      if (code.startsWith('__END__', i) && [undefined, '\n', '\r'].includes(code[i + 7])) break;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      spaceBefore = true;
      continue;
    }
    lineStart = false;

    if (c === '#') {
      const eol = code.indexOf('\n', i);
      i = eol < 0 ? n : eol;
      continue;
    }

    if (c === '"' || c === "'") {
      const endQ = c === '"' ? skipDouble(i + 1, '"') : skipSingle(i + 1, "'");
      if (endQ > i + 1 && endQ < n) {
        out.push({ start: i + 1, end: endQ, quote: c, content: code.slice(i + 1, endQ), line: lineAt(i) });
      }
      i = endQ + 1;
      last = 'v';
      spaceBefore = false;
      continue;
    }
    if (c === '`') {
      i = skipDouble(i + 1, '`') + 1;
      last = 'v';
      spaceBefore = false;
      continue;
    }
    if (c === ':' && (code[i + 1] === '"' || code[i + 1] === "'")) {
      // :"symbol"
      const q = code[i + 1];
      i = (q === '"' ? skipDouble(i + 2, '"') : skipSingle(i + 2, "'")) + 1;
      last = 'v';
      spaceBefore = false;
      continue;
    }
    if (c === '?' && i + 1 < n && !/\s/.test(code[i + 1]) && exprStart()) {
      // 字符字面量 ?a / ?\n
      const next = code[i + 1];
      const len = next === '\\' ? 3 : 2;
      if (!isIdentChar(code[i + len] ?? ' ') || next === '\\') {
        i += len;
        last = 'v';
        spaceBefore = false;
        continue;
      }
    }
    if (c === '$') {
      // 全局变量，包括 $" $' $~ $1 等特殊变量
      if (/[~*$?!@/\\;,.=:<>"'`&+0-9]/.test(code[i + 1] ?? '')) i += 2;
      else {
        i++;
        while (i < n && isIdentChar(code[i])) i++;
      }
      last = 'w';
      spaceBefore = false;
      continue;
    }
    if (c === '%') {
      const m = /^%([qQwWiIrsx]?)([^\w\s])/.exec(code.slice(i, i + 3));
      const typed = m && m[1] !== '';
      const bare = m && m[1] === '' && /[([{<|!/^]/.test(m[2]) && (exprStart() || (spaceBefore && !/\s/.test(code[i + 2] ?? ' ')));
      if (m && (typed ? exprStart() || spaceBefore : bare)) {
        const open = m[2];
        const close = PAIRS[open] ?? open;
        const from = i + 1 + m[1].length + 1;
        const end = 'qwis'.includes(m[1]) && m[1] !== ''
          ? skipSingle(from, close, PAIRS[open] ? open : undefined)
          : skipDouble(from, close, PAIRS[open] ? open : undefined);
        i = end + 1;
        if (m[1] === 'r') while (i < n && /[a-z]/.test(code[i])) i++;
        last = 'v';
        spaceBefore = false;
        continue;
      }
    }
    if (c === '/' && (exprStart() || (spaceBefore && last === 'w' && !/\s/.test(code[i + 1] ?? ' ')))) {
      // 正则字面量
      i = skipDouble(i + 1, '/') + 1;
      while (i < n && /[a-z]/.test(code[i])) i++;
      last = 'v';
      spaceBefore = false;
      continue;
    }
    if (c === '<' && code[i + 1] === '<') {
      const m = /^<<([-~]?)(["'`]?)([A-Za-z_]\w*)\2/.exec(code.slice(i, i + 80));
      const explicit = !!m && (m[1] !== '' || m[2] !== '');
      if (m && (explicit ? exprStart() || spaceBefore : /^[A-Z_]/.test(m[3]) && exprStart())) {
        heredocs.push({ id: m[3], indent: m[1] !== '' });
        i += m[0].length;
        last = 'v';
        spaceBefore = false;
        continue;
      }
    }
    if (isIdentStart(c) || c === '@') {
      let j = i + 1;
      while (j < n && isIdentChar(code[j])) j++;
      if (code[j] === '?' || code[j] === '!') {
        if (code[j + 1] !== '=') j++;
      }
      const word = code.slice(i, j).replace(/^@+/, '');
      last = KEYWORDS.has(word) ? 'k' : 'w';
      i = j;
      spaceBefore = false;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoObB_.eE]/.test(code[j])) {
        if (code[j] === '.' && !/[0-9]/.test(code[j + 1] ?? '')) break;
        j++;
      }
      i = j;
      last = 'n';
      spaceBefore = false;
      continue;
    }
    // 运算符 / 标点
    last = c === ')' || c === ']' || c === '}' ? 'v' : c;
    i++;
    spaceBefore = false;
  }
  return out;
}

/** 写回时转义译文中未转义的定界引号，并保证结尾不会把引号转义掉 */
export function escapeForQuote(text: string, quote: '"' | "'"): string {
  let out = '';
  let backslashes = 0;
  /** 双引号中 #{...} 插值内部是代码，不能转义 */
  let interp = 0;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (interp > 0) {
      if (ch === '{') interp++;
      else if (ch === '}') interp--;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      backslashes++;
      out += ch;
      continue;
    }
    if (quote === '"' && ch === '#' && chars[i + 1] === '{' && backslashes % 2 === 0) {
      interp = 1;
      out += '#{';
      i++;
      backslashes = 0;
      continue;
    }
    if (ch === quote && backslashes % 2 === 0) out += '\\';
    out += ch;
    backslashes = 0;
  }
  if (backslashes % 2 === 1) out += '\\';
  return out;
}
