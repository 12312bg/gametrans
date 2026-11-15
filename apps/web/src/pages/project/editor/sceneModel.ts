import type { BranchStep } from '@gametrans/shared';

/** 整段事件中的一条词条（只用到这些字段） */
export interface SceneEntry {
  id: string;
  key: string;
  category: string;
  branch: BranchStep[] | null;
}

/** 一组「显示选项」：同一条指令的选项词条 */
export interface ChoiceGroup<T extends SceneEntry> {
  id: string;
  /** 选项所在的分支深度 */
  depth: number;
  options: { i: number; entry: T }[];
}

export type SceneNode<T extends SceneEntry> =
  | { type: 'row'; entry: T; depth: number }
  | { type: 'head'; step: BranchStep; depth: number }
  | { type: 'choices'; group: ChoiceGroup<T>; selected: number }
  /** 所选选项之后的分支标题；hidden 为其他选项下被隐藏的词条数 */
  | { type: 'picked'; group: ChoiceGroup<T>; i: number; text: string; hidden: number; depth: number };

/** 「显示选项」指令下标：选项词条的键为 …/list/<下标>/<序号> */
function choiceCommand(key: string): string | null {
  const m = /\/list\/(\d+)\/\d+$/.exec(key);
  return m ? m[1] : null;
}

/**
 * 每条词条所在路径上的选项分支：[分组 ID, 选项序号]。
 * 新数据的分支步骤带指令下标 at；旧数据按「之前最近、同一深度的选项分组」推断。
 */
export function analyzeScene<T extends SceneEntry>(items: T[]) {
  const groups = new Map<string, ChoiceGroup<T>>();
  const lastAtDepth = new Map<number, string>();
  const choicePath = new Map<string, [string, number][]>();
  for (const e of items) {
    const path = e.branch ?? [];
    const steps: [string, number][] = [];
    path.forEach((s, d) => {
      if (s.k !== 'choice') return;
      const gid = s.at !== undefined ? String(s.at) : lastAtDepth.get(d);
      if (gid !== undefined) steps.push([gid, s.i]);
    });
    choicePath.set(e.id, steps);
    const cmd = e.category === 'choice' ? choiceCommand(e.key) : null;
    if (cmd !== null) {
      const g = groups.get(cmd) ?? { id: cmd, depth: path.length, options: [] };
      g.options.push({ i: Number(e.key.split('/').pop()) + 1, entry: e });
      groups.set(cmd, g);
      lastAtDepth.set(path.length, cmd);
    }
  }
  return { groups, choicePath };
}

/** 每组默认显示第一个选项 */
export const defaultSelected = (g: ChoiceGroup<SceneEntry>) => g.options[0]?.i ?? 1;

/**
 * 生成右栏的显示节点：未选中的选项分支下的词条隐藏；
 * 选项分组显示为一个块，其后是「选择 X 后」标题，再是其他分支标题（条件分支等）与词条。
 */
export function buildScene<T extends SceneEntry>(items: T[], selected: Record<string, number>): SceneNode<T>[] {
  const { groups, choicePath } = analyzeScene(items);
  const pick = (gid: string) => selected[gid] ?? defaultSelected(groups.get(gid) ?? { id: gid, depth: 0, options: [] });
  const visible = (e: T) => (choicePath.get(e.id) ?? []).every(([g, i]) => pick(g) === i);
  const hiddenIn = (gid: string) =>
    items.filter((e) => e.category !== 'choice' || choiceCommand(e.key) !== gid).filter((e) => (choicePath.get(e.id) ?? []).some(([g, i]) => g === gid && pick(g) !== i)).length;

  const out: SceneNode<T>[] = [];
  const shownGroups = new Set<string>();
  let prev: BranchStep[] = [];
  for (const e of items) {
    if (!visible(e)) continue;
    const cmd = e.category === 'choice' ? choiceCommand(e.key) : null;
    if (cmd !== null) {
      if (!shownGroups.has(cmd)) {
        shownGroups.add(cmd);
        const g = groups.get(cmd)!;
        out.push({ type: 'choices', group: g, selected: pick(cmd) });
        const opt = g.options.find((o) => o.i === pick(cmd));
        out.push({ type: 'picked', group: g, i: pick(cmd), text: opt?.entry ? optionText(opt.entry) : '', hidden: hiddenIn(cmd), depth: g.depth });
        // 选项块之后的词条重新计算分支标题
        prev = [...(e.branch ?? []), { k: 'choice', i: pick(cmd), text: '', at: Number(cmd) }];
      }
      continue;
    }
    const path = e.branch ?? [];
    let common = 0;
    while (common < path.length && common < prev.length && sameStep(path[common], prev[common])) common++;
    for (let d = common; d < path.length; d++) {
      // 选项分支已由「选择 X 后」表示
      if (path[d].k !== 'choice') out.push({ type: 'head', step: path[d], depth: d });
    }
    out.push({ type: 'row', entry: e, depth: path.length });
    prev = path;
  }
  return out;
}

const optionText = (e: SceneEntry & { original?: string }) => e.original ?? '';

/** 比较时忽略选项步骤的文字（选项块之后写入的占位步骤没有文字） */
function sameStep(a: BranchStep, b: BranchStep) {
  if (a.k === 'choice' && b.k === 'choice') return a.i === b.i && (a.at === undefined || b.at === undefined || a.at === b.at);
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 当前词条所在的选项分支：切换到这些选项，保证当前词条可见 */
export function selectionFor<T extends SceneEntry>(items: T[], entryId: string): Record<string, number> {
  const { choicePath } = analyzeScene(items);
  return Object.fromEntries(choicePath.get(entryId) ?? []);
}
