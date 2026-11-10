export interface ReplaceOptions {
  find: string;
  replace: string;
  /** find 为正则表达式，replace 中可用 $1 等引用分组 */
  regex?: boolean;
  caseSensitive?: boolean;
}

export const MAX_FIND_LENGTH = 500;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 构造全局匹配用的正则；表达式无效或会匹配空字符串时返回 null */
export function buildMatcher(o: Pick<ReplaceOptions, 'find' | 'regex' | 'caseSensitive'>): RegExp | null {
  if (!o.find || o.find.length > MAX_FIND_LENGTH) return null;
  let re: RegExp;
  try {
    re = new RegExp(o.regex ? o.find : escapeRegExp(o.find), o.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
  return re.test('') ? null : re;
}

export interface ReplaceSegment {
  text: string;
  /** 被替换掉的原文片段 / 替换进来的新片段 */
  changed: boolean;
}

/** 替换并给出前后两段文本中变化的位置，用于预览高亮 */
export function replaceWithSegments(text: string, re: RegExp, o: Pick<ReplaceOptions, 'replace' | 'regex'>) {
  const before: ReplaceSegment[] = [];
  const after: ReplaceSegment[] = [];
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  let pos = 0;
  let count = 0;
  for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
    const start = m.index!;
    if (start > pos) {
      before.push({ text: text.slice(pos, start), changed: false });
      after.push({ text: text.slice(pos, start), changed: false });
    }
    // 普通文本替换不解析 $ 符号；正则替换支持 $1 等分组引用
    const rep = o.regex ? m[0].replace(single, o.replace) : o.replace;
    before.push({ text: m[0], changed: true });
    if (rep) after.push({ text: rep, changed: true });
    pos = start + m[0].length;
    count++;
  }
  if (pos < text.length) {
    before.push({ text: text.slice(pos), changed: false });
    after.push({ text: text.slice(pos), changed: false });
  }
  return { result: after.map((s) => s.text).join(''), count, before, after };
}
