/**
 * 翻译记忆模糊匹配：字符级编辑距离 + 最长公共子串。
 * 服务端用它对 pg_trgm 召回的候选重新打分排序，前端用 diffSegments 高亮差异。
 */

/** 打分时每段文本最多参与比较的字符数（避免超长文本 O(n·m) 过慢） */
const SCORE_CAP = 500;
/** 差异高亮时中间段（去掉公共前后缀后）的最大长度 */
const DIFF_CAP = 400;

export type FuzzyKind = 'exact' | 'contains' | 'contained' | 'partial' | 'similar';

export interface FuzzyResult {
  /** 编辑相似度 0~1：1 - 编辑距离 / 较长文本长度（CAT 工具常用的模糊匹配率） */
  score: number;
  /** 排序用的综合分 0~1：兼顾整体相似与片段包含 */
  rank: number;
  /** 最长公共子串长度 */
  common: number;
  /**
   * exact：相同；contains：候选包含当前原文；contained：候选是当前原文的一部分；
   * partial：有较长的相同片段但整体差异大；similar：整体相似
   */
  kind: FuzzyKind;
}

export function normalizeForMatch(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function longestCommonSubstring(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  let best = 0;
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return best;
}

/** 计算候选原文 candidate 相对当前原文 source 的匹配情况 */
export function fuzzyMatch(source: string, candidate: string): FuzzyResult {
  const a = normalizeForMatch(source);
  const b = normalizeForMatch(candidate);
  if (!a.length || !b.length) return { score: 0, rank: 0, common: 0, kind: 'similar' };
  if (a === b) return { score: 1, rank: 1, common: a.length, kind: 'exact' };
  const sa = a.slice(0, SCORE_CAP);
  const sb = b.slice(0, SCORE_CAP);
  const maxLen = Math.max(sa.length, sb.length);
  const minLen = Math.min(sa.length, sb.length);
  const score = 1 - levenshtein(sa, sb) / maxLen;

  let kind: FuzzyKind = 'similar';
  let common: number;
  if (b.includes(a)) {
    kind = 'contains';
    common = a.length;
  } else if (a.includes(b)) {
    kind = 'contained';
    common = b.length;
  } else {
    common = longestCommonSubstring(sa, sb);
  }
  // 片段分：公共片段占较短文本的比例，并按长度比例适当折减（长句中的一个短词不应排到前面）
  const cover = Math.min(1, common / minLen);
  const fragment = common >= 2 ? cover * (0.55 + 0.35 * (minLen / maxLen)) : 0;
  if (kind === 'similar' && fragment > score && cover >= 0.5 && common >= 3) kind = 'partial';
  const rank = Math.max(score, fragment);
  return { score: round(score), rank: round(rank), common, kind };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export interface DiffSegment {
  text: string;
  /** true：与当前原文相同的部分 */
  same: boolean;
}

/**
 * 以 source 为基准，把 candidate 切分为「相同 / 不同」片段（字符级 LCS）。
 * 用于在翻译记忆中高亮候选原文与当前原文的差异。
 */
export function diffSegments(source: string, candidate: string): DiffSegment[] {
  const a = source;
  const b = candidate;
  if (!b) return [];
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  const out: DiffSegment[] = [];
  const push = (text: string, same: boolean) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.same === same) last.text += text;
    else out.push({ text, same });
  };
  push(b.slice(0, pre), true);
  if (bm) {
    if (!am || am.length > DIFF_CAP || bm.length > DIFF_CAP) {
      push(bm, false);
    } else {
      // LCS 表（从尾部开始），再顺序回溯得到 bm 中每个字符是否相同
      const n = am.length;
      const m = bm.length;
      const w = m + 1;
      const dp = new Uint16Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (j < m) {
        if (i < n && am[i] === bm[j]) {
          push(bm[j], true);
          i++;
          j++;
        } else if (i < n && dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
          i++;
        } else {
          push(bm[j], false);
          j++;
        }
      }
    }
  }
  push(b.slice(b.length - suf), true);
  // 零散的单字符「相同」夹在差异中间时视为差异，避免高亮过碎
  return out.reduce<DiffSegment[]>((acc, s, k) => {
    const isNoise = s.same && s.text.length === 1 && k > 0 && k < out.length - 1;
    const seg = isNoise ? { text: s.text, same: false } : s;
    const last = acc[acc.length - 1];
    if (last && last.same === seg.same) last.text += seg.text;
    else acc.push({ ...seg });
    return acc;
  }, []);
}
