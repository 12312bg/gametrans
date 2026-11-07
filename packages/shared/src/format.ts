/** 由「键 + 参数」组成的结构化文本，按查看者的语言渲染 */
export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

export interface ContextPart {
  k: string;
  p?: Params;
}

/** 词条位置说明：各段以 · 连接，ctx.sub* 为嵌套路径，用空格连接 */
export function formatContext(parts: ContextPart[] | null | undefined, t: Translate): string {
  let out = '';
  for (const part of parts ?? []) {
    const text = t(part.k, part.p);
    out = !out ? text : part.k.startsWith('ctx.sub') ? `${out} ${text}` : `${out} · ${text}`;
  }
  return out;
}

/** 位置说明的搜索文本：只取参数值（地图名、事件名等与语言无关） */
export function contextSearchText(parts: ContextPart[]): string {
  return parts.flatMap((p) => Object.values(p.p ?? {})).join(' ');
}

/** 解析 / 导出过程中的提示，code 对应 i18n 的 issue.<CODE> */
export interface Issue {
  code: string;
  params?: Params;
}

export interface ActivityLike {
  type: string;
  params?: Params | null;
  /** 旧版数据只有中文文本 */
  message?: string | null;
}

export function formatActivity(a: ActivityLike, t: Translate): string {
  if (!a.params) return a.message ?? '';
  const p: Params = { ...a.params };
  if (typeof p.role === 'string') p.role = t(`role.${p.role}`);
  if (typeof p.action === 'string') p.action = t(`batch.${p.action}`);
  return t(`activity.${a.type}`, p);
}
