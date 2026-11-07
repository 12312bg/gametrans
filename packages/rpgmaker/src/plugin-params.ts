import type { WalkContext } from './events';

const TRIVIAL = /^(?:\s*|-?\d+(?:\.\d+)?|true|false|on|off|null)$/i;

/** 插件参数中明显不需要翻译的值（空、数字、布尔） */
export function isTrivialPluginValue(v: string): boolean {
  return TRIVIAL.test(v);
}

/**
 * 处理一个插件参数字符串：
 * - 若是 JSON 编码的对象/数组（MV/MZ 的 struct / 列表参数），递归展开其中的字符串；
 *   全部译文写入后由 finalizer 重新 JSON 编码写回父级。
 * - 否则作为一个危险词条输出。
 */
export function emitPluginValue(
  raw: string,
  key: string,
  context: string,
  set: (v: string) => void,
  ctx: WalkContext,
): void {
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
      // 子级 finalizer 先于父级注册，按注册顺序执行即可保证由内向外重新编码
      ctx.finalizers.push(() => {
        if (state.dirty) set(JSON.stringify(parsed));
      });
      return;
    }
  }
  if (isTrivialPluginValue(raw)) return;
  ctx.emit({ key, original: raw, context, category: 'plugin', danger: true, set });
}

function walkJson(
  node: Record<string, unknown> | unknown[],
  key: string,
  context: string,
  markDirty: () => void,
  ctx: WalkContext,
): void {
  const keys = Array.isArray(node) ? node.map((_, i) => i) : Object.keys(node);
  for (const k of keys) {
    const v = (node as Record<string | number, unknown>)[k];
    const childKey = `${key}/${k}`;
    const childCtx = `${context} › ${Array.isArray(node) ? `#${Number(k) + 1}` : k}`;
    if (typeof v === 'string') {
      emitPluginValue(
        v,
        childKey,
        childCtx,
        (nv) => {
          (node as Record<string | number, unknown>)[k] = nv;
          markDirty();
        },
        ctx,
      );
    } else if (v !== null && typeof v === 'object') {
      walkJson(v as Record<string, unknown>, childKey, childCtx, markDirty, ctx);
    }
  }
}
