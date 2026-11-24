import { UnsupportedFileError } from '../types';

/**
 * Twine 故事的容器层：编译后的 HTML（<tw-storydata> / <tw-passagedata>）或 Tweego 源码（.twee）。
 * 只定位各段落在原文件中的位置；回写时按位置替换，其余字节原样保留。
 */

export interface PassageSource {
  name: string;
  tags: string[];
  /** 段落正文（HTML 中已还原转义） */
  text: string;
  /** 正文下标 → 原文件下标（长度为 text.length + 1） */
  toRaw(i: number): number;
  /** 写回时把正文片段转成原文件中的写法 */
  escape(s: string): string;
}

export interface StoryContainer {
  container: 'html' | 'twee';
  /** 故事格式，如 SugarCube 2.36.1；twee 没有 StoryData 时为空 */
  format: string;
  formatVersion: string;
  passages: PassageSource[];
  /** HTML 的 Story JavaScript（原样，无转义） */
  script?: PassageSource;
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** 还原 HTML 转义并记录下标映射 */
export function decodeWithMap(raw: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '&') {
      const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/.exec(raw.slice(i, i + 12));
      const ch = m ? (m[1] ? String.fromCodePoint(Number(m[1])) : m[2] ? String.fromCodePoint(parseInt(m[2], 16)) : NAMED[m[3]]) : undefined;
      if (m && ch !== undefined) {
        for (let k = 0; k < ch.length; k++) {
          map.push(i);
          text += ch[k];
        }
        i += m[0].length;
        continue;
      }
    }
    map.push(i);
    text += raw[i];
    i++;
  }
  map.push(raw.length);
  return { text, map };
}

/** 按原文件的风格转义：Twine 2 用 &quot; &#39;，Tweego 用 &quot; 或 &#34; */
function htmlEscaper(sample: string): (s: string) => string {
  const dq = sample.includes('&#34;') && !sample.includes('&quot;') ? '&#34;' : '&quot;';
  const sq = sample.includes('&apos;') && !sample.includes('&#39;') ? '&apos;' : sample.includes('&#x27;') ? '&#x27;' : '&#39;';
  return (s) => s.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? dq : sq));
}

const attr = (attrs: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(` ${attrs}`);
  return m ? decodeWithMap(m[1] ?? m[2]).text : undefined;
};

export function parseStoryHtml(html: string): StoryContainer {
  const open = /<tw-storydata\b([^>]*)>/i.exec(html);
  if (!open) {
    if (/<div\s+id=["']store(?:-a|A)rea["']/i.test(html)) throw new UnsupportedFileError('TWINE_TWINE1');
    throw new UnsupportedFileError('TWINE_NOT_STORY');
  }
  const format = attr(open[1], 'format') ?? '';
  const formatVersion = attr(open[1], 'format-version') ?? '';
  checkFormat(format, formatVersion);
  const bodyStart = open.index + open[0].length;
  const closeAt = html.indexOf('</tw-storydata>', bodyStart);
  const bodyEnd = closeAt < 0 ? html.length : closeAt;
  const body = html.slice(bodyStart, bodyEnd);
  const escape = htmlEscaper(body);

  const passages: PassageSource[] = [];
  const re = /<tw-passagedata\b([^>]*)>([\s\S]*?)<\/tw-passagedata>/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const rawStart = bodyStart + m.index + m[0].indexOf('>') + 1;
    const { text, map } = decodeWithMap(m[2]);
    const tags = (attr(m[1], 'tags') ?? '').split(/\s+/).filter(Boolean);
    passages.push({ name: attr(m[1], 'name') ?? '', tags, text, toRaw: (i) => rawStart + map[i], escape });
  }

  let script: PassageSource | undefined;
  const s = /<script\b[^>]*\bid=["']twine-user-script["'][^>]*>([\s\S]*?)<\/script>/i.exec(body);
  if (s) {
    const rawStart = bodyStart + s.index + s[0].indexOf('>') + 1;
    script = { name: '', tags: [], text: s[1], toRaw: (i) => rawStart + i, escape: (x) => x.replace(/<\/script/gi, '<\\/script') };
  }
  return { container: 'html', format, formatVersion, passages, script };
}

function checkFormat(format: string, version: string) {
  if (format && !/^sugarcube$/i.test(format.trim())) throw new UnsupportedFileError('TWINE_FORMAT_UNSUPPORTED', { format: `${format} ${version}`.trim() });
}

const unescapeTwee = (s: string) => s.replace(/\\(.)/g, '$1');

/**
 * Twee 3（Tweego）：「:: 名称 [标签] {元数据}」开头，正文到下一个 :: 行为止。
 * StoryData 段落中的 format 用于判断故事格式。
 */
export function parseTwee(src: string): StoryContainer {
  const headers: { name: string; tags: string[]; lineStart: number; bodyStart: number }[] = [];
  const re = /^::[ \t]*(.*)$/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const head = m[1];
    // 名称中的 [ ] { } 需要用反斜杠转义，第一个未转义的 [ 或 { 之后是标签 / 元数据
    let cut = head.length;
    for (let i = 0; i < head.length; i++) {
      if (head[i] === '\\') i++;
      else if (head[i] === '[' || head[i] === '{') {
        cut = i;
        break;
      }
    }
    const name = unescapeTwee(head.slice(0, cut).trim());
    const tagM = /^\s*\[([^\]]*)\]/.exec(head.slice(cut));
    const tags = tagM ? tagM[1].split(/\s+/).filter(Boolean).map(unescapeTwee) : [];
    const nl = src.indexOf('\n', m.index);
    headers.push({ name, tags, lineStart: m.index, bodyStart: nl < 0 ? src.length : nl + 1 });
  }
  if (!headers.length) throw new UnsupportedFileError('TWINE_NOT_STORY');

  let format = '';
  let formatVersion = '';
  const passages: PassageSource[] = [];
  headers.forEach((h, k) => {
    const end = k + 1 < headers.length ? headers[k + 1].lineStart : src.length;
    const text = src.slice(h.bodyStart, Math.max(h.bodyStart, end));
    if (h.name === 'StoryData') {
      try {
        const data = JSON.parse(text) as { format?: string; 'format-version'?: string };
        format = data.format ?? '';
        formatVersion = data['format-version'] ?? '';
      } catch {
        // StoryData 无法解析时按 SugarCube 处理
      }
    }
    const rawStart = h.bodyStart;
    passages.push({ name: h.name, tags: h.tags, text, toRaw: (i) => rawStart + i, escape: (x) => x.replace(/^::/gm, ' ::') });
  });
  checkFormat(format, formatVersion);
  return { container: 'twee', format, formatVersion, passages };
}
