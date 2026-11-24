import { TwToken, lexSugarCube } from './lexer';

/**
 * Twine 词条中要原样保留的标记：宏、HTML 标签、变量、格式标记、注释、图片、链接外壳。
 * 链接只标出外壳（[[ 与 |目标]]），显示文字可以翻译；[[目标]] 整体保留。
 */
export function twineCodeSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const tok of lexSugarCube(text)) {
    if (tok.t === 'text' || tok.t === 'nl') continue;
    if (tok.t === 'link' && tok.link.form !== 'simple') {
      if (tok.link.labelStart > tok.start) out.push({ start: tok.start, end: tok.link.labelStart });
      if (tok.end > tok.link.labelEnd) out.push({ start: tok.link.labelEnd, end: tok.end });
    } else {
      out.push({ start: tok.start, end: tok.end });
    }
  }
  return out;
}

/** 比较用的标记：链接按目标比较（显示文字可变），宏与标签忽略多余空白 */
function codeOf(text: string, tok: TwToken): string | null {
  switch (tok.t) {
    case 'text':
    case 'nl':
      return null;
    case 'link':
      return tok.link.form === 'simple' ? text.slice(tok.start, tok.end) : `[[…|${tok.link.target}]]`;
    case 'macro':
    case 'html':
      return text.slice(tok.start, tok.end).replace(/\s+/g, ' ');
    default:
      return text.slice(tok.start, tok.end);
  }
}

/** 词条中的 Twine 标记（显示用原样，比较键见 twineCodeKey） */
export function extractTwineCodes(text: string): string[] {
  const out: string[] = [];
  for (const tok of lexSugarCube(text)) {
    const c = codeOf(text, tok);
    if (c !== null) out.push(c);
  }
  return out;
}
