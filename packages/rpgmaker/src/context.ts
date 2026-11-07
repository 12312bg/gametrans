import type { ContextPart } from '@gametrans/shared';

/** 位置说明各段的构造函数，MV/MZ 与 RGSS 共用 */
export const ctx = {
  raw: (text: string): ContextPart => ({ k: 'ctx.raw', p: { text } }),
  rawIndex: (text: string, i: number): ContextPart => ({ k: 'ctx.rawIndex', p: { text, i } }),
  of: (k: string, p?: ContextPart['p']): ContextPart => (p ? { k, p } : { k }),
  event: (id: number, name: string, x: unknown, y: unknown): ContextPart => ({ k: 'ctx.event', p: { id, name, x: String(x ?? '?'), y: String(y ?? '?') } }),
  page: (index: number): ContextPart => ({ k: 'ctx.page', p: { n: index + 1 } }),
  commonEvent: (id: number, name: string): ContextPart => ({ k: 'ctx.commonEvent', p: { id, name } }),
  troop: (id: number, name: string): ContextPart => ({ k: 'ctx.troop', p: { id, name } }),
  row: (kind: string, id: number, name: string): ContextPart => ({ k: `ctx.row.${kind}`, p: { id, name } }),
  field: (json: string): ContextPart => ({ k: `ctx.field.${json}` }),
};

export function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, '');
}
