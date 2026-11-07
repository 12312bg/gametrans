import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { STAGES, Stage } from '@gametrans/shared';
import type { StageCounts } from './api/types';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export const fromNow = (d: string | Date) => dayjs(d).fromNow();
export const formatTime = (d: string | Date) => dayjs(d).format('YYYY-MM-DD HH:mm');

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 进度统计：隐藏的词条不计入总数 */
export function progressOf(stats: StageCounts | undefined) {
  const s = stats ?? (Object.fromEntries(STAGES.map((k) => [k, 0])) as Record<Stage, number>);
  const total = s.UNTRANSLATED + s.TRANSLATED + s.QUESTIONED + s.REVIEWED + s.LOCKED;
  const translated = s.TRANSLATED + s.QUESTIONED + s.REVIEWED + s.LOCKED;
  const reviewed = s.REVIEWED + s.LOCKED;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return { total, translated, reviewed, hidden: s.HIDDEN, translatedPct: pct(translated), reviewedPct: pct(reviewed), s };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 根据字符串生成稳定的颜色，用于头像 */
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6'];
  return palette[h % palette.length];
}
