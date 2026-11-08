import { ContextPart, Issue, LANGUAGE_CODES, formatActivity, formatContext, hasMessage } from '@gametrans/shared';
import type { TFn } from '.';

/** 词条位置说明：优先用结构化数据按当前语言渲染，旧数据回退为服务端文本 */
export function contextText(e: { contextData?: ContextPart[] | null; contextText?: string; contextSearch?: string }, t: TFn): string {
  return e.contextData ? formatContext(e.contextData, t) : e.contextText ?? e.contextSearch ?? '';
}

type LegacyIssue = Partial<Issue> & { reason?: string; message?: string };

/** 解析 / 导出提示；兼容旧版只有中文 reason / message 的数据 */
export function issueText(i: LegacyIssue | string, t: TFn): string {
  if (typeof i === 'string') return i;
  return i.code ? t(`issue.${i.code}`, i.params) : i.reason ?? i.message ?? '';
}

/** 任务失败原因：存的是提示码时翻译，否则原样显示 */
export function jobErrorText(error: string | null | undefined, t: TFn): string {
  if (!error) return '';
  return hasMessage(`issue.${error}`) ? t(`issue.${error}`) : error;
}

export function activityText(a: { type: string; params?: Record<string, string | number> | null; message?: string }, t: TFn): string {
  return formatActivity(a, t);
}

/** 批量操作的历史备注存的是操作码（旧数据为中文） */
export function historyNote(action: string, note: string, t: TFn): string {
  return action === 'BATCH' && hasMessage(`batch.${note}`) ? t(`batch.${note}`) : note;
}

export const langOptions = (t: TFn) => LANGUAGE_CODES.map((code) => ({ label: t('common.langOption', { name: t(`lang.${code}`), code }), value: code }));
