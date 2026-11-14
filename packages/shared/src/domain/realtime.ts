import type { HistoryAction, Stage } from './entries';

/** 实时推送（SSE）与项目历史记录的共享类型 */

export interface RtUser {
  id: string;
  username: string;
  displayName: string;
}

/** 单条词条的变化：只含与语言无关的字段，客户端直接合并到缓存 */
export interface RtEntryPatch {
  id: string;
  version: number;
  translation: string;
  stage: Stage;
  translator: RtUser | null;
  reviewer: RtUser | null;
  updatedAt: string;
}

export interface RtPresenceItem {
  user: RtUser;
  /** 正在编辑的词条；只是打开项目时为 null */
  entryIds: string[];
}

export type RtEvent =
  /** 连接建立：连接 ID 用于上报正在编辑的词条 */
  | { type: 'hello'; connId: string }
  | { type: 'entry'; by: RtUser | null; entry: RtEntryPatch }
  /** 批量变更（批量操作、替换、记忆填充、文件解析等）：客户端重新加载列表 */
  | { type: 'entries'; by: RtUser | null; count: number }
  | { type: 'terms'; by: RtUser | null }
  | { type: 'files'; by: RtUser | null }
  | { type: 'presence'; items: RtPresenceItem[] };

/** 项目历史记录的类型筛选 */
export const HISTORY_TYPES = ['translate', 'review', 'import', 'term'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

/** 词条历史 action → 历史记录类型 */
export const HISTORY_TYPE_ACTIONS: Record<Exclude<HistoryType, 'term'>, HistoryAction[]> = {
  translate: ['TRANSLATE', 'ROLLBACK', 'TM_FILL', 'SYNC', 'REPLACE'],
  review: ['STAGE', 'BATCH'],
  import: ['SOURCE_CHANGED', 'IMPORT'],
};

export const TERM_HISTORY_ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'IMPORT'] as const;
export type TermHistoryAction = (typeof TERM_HISTORY_ACTIONS)[number];

export interface TermSnapshot {
  term: string;
  translation: string;
  note: string;
  caseSensitive: boolean;
}
