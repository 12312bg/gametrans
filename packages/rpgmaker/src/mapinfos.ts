import { ctx as c } from './context';
import type { Slot } from './types';

export interface MapInfoRow {
  id: number;
  name: string | undefined;
  parentId: number;
  /** 编辑器地图树中的顺序 */
  order: number;
  set(value: string): void;
}

/**
 * MapInfos 中的地图名：通常只在编辑器中使用（进入地图时显示的是地图文件里的「显示名称」），
 * 但有插件 / 脚本会读取并显示（如存档界面、地点提示），因此提取并默认隐藏。
 * 按编辑器地图树的顺序排列，位置说明附上上级地图的路径，便于区分同名地图。
 */
export function emitMapNames(rows: MapInfoRow[], slots: Slot[]): void {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentPath = (row: MapInfoRow) => {
    const names: string[] = [];
    const seen = new Set([row.id]);
    for (let p = byId.get(row.parentId); p && !seen.has(p.id); p = byId.get(p.parentId)) {
      seen.add(p.id);
      names.unshift(p.name ?? '');
    }
    return names.join(' / ');
  };
  for (const row of [...rows].sort((a, b) => a.order - b.order || a.id - b.id)) {
    if (typeof row.name !== 'string' || !row.name.trim()) continue;
    const path = parentPath(row);
    slots.push({
      key: `${row.id}/name`,
      original: row.name,
      context: [c.of('ctx.mapInfo', { id: row.id }), ...(path ? [c.of('ctx.mapParent', { path })] : [])],
      category: 'mapName',
      danger: true,
      set: row.set,
    });
  }
}
