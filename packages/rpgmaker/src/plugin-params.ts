import type { ContextPart } from '@gametrans/shared';
import type { WalkContext } from './events';

const TRIVIAL = /^(?:\s*|-?\d+(?:\.\d+)?|true|false|on|off|null)$/i;

export function isTrivialPluginValue(v: string): boolean {
  return TRIVIAL.test(v);
}

/**
 * 插件参数：JSON 编码的 struct / 列表递归展开，写回时由 finalizer 由内向外重新编码；
 * 其余非空、非数字、非布尔的值作为危险词条输出。
 */
export function emitPluginValue(raw: string, key: string, context: ContextPart[], set: (v: string) => void, ctx: WalkContext): void {
  const t = raw.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (parsed !== null && typeof parsed === 'object') {
      const state = { dirty: false };
      walkJson(parsed as Record<string, unknown>, key, context, () => (state.dirty = true), ctx);
      ctx.finalizers.push(() => {
        if (state.dirty) set(JSON.stringify(parsed));
      });
      return;
    }
  }
  if (isTrivialPluginValue(raw)) return;
  ctx.emit({ key, original: raw, context, category: 'plugin', danger: true, set });
}

function walkJson(node: Record<string, unknown> | unknown[], key: string, context: ContextPart[], markDirty: () => void, ctx: WalkContext): void {
  const isArr = Array.isArray(node);
  const keys = isArr ? node.map((_, i) => i) : Object.keys(node);
  for (const k of keys) {
    const holder = node as Record<string | number, unknown>;
    const v = holder[k];
    const childKey = `${key}/${k}`;
    const childCtx: ContextPart[] = [...context, isArr ? { k: 'ctx.subIndex', p: { n: Number(k) + 1 } } : { k: 'ctx.sub', p: { name: String(k) } }];
    if (typeof v === 'string') {
      emitPluginValue(v, childKey, childCtx, (nv) => {
        holder[k] = nv;
        markDirty();
      }, ctx);
    } else if (v !== null && typeof v === 'object') {
      walkJson(v as Record<string, unknown>, childKey, childCtx, markDirty, ctx);
    }
  }
}
