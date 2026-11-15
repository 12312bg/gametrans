import { describe, expect, it } from 'vitest';
import type { BranchStep } from '@gametrans/shared';
import { buildScene, selectionFor } from '../src/pages/project/editor/sceneModel';

const yes = (at?: number): BranchStep => ({ k: 'choice', i: 1, text: 'Yes', ...(at !== undefined ? { at } : {}) });
const no = (at?: number): BranchStep => ({ k: 'choice', i: 2, text: 'No', ...(at !== undefined ? { at } : {}) });
const cond: BranchStep = { k: 'if', type: 0, args: [1, 0] };
const P = 'events/1/pages/0/list';

function scene(at?: number) {
  return [
    { id: 'a', key: `${P}/0`, category: 'dialogue', original: 'Help?', branch: null },
    { id: 'c1', key: `${P}/2/0`, category: 'choice', original: 'Yes', branch: null },
    { id: 'c2', key: `${P}/2/1`, category: 'choice', original: 'No', branch: null },
    { id: 'y1', key: `${P}/4`, category: 'dialogue', original: 'Thanks', branch: [yes(at)] },
    { id: 'y2', key: `${P}/7`, category: 'dialogue', original: 'Strong', branch: [yes(at), cond] },
    { id: 'n1', key: `${P}/12`, category: 'dialogue', original: 'I see', branch: [no(at)] },
    { id: 'z', key: `${P}/15`, category: 'dialogue', original: 'Bye', branch: null },
  ];
}

const shape = (nodes: ReturnType<typeof buildScene>) =>
  nodes.map((n) => (n.type === 'row' ? n.entry.id : n.type === 'head' ? `head:${n.step.k}` : n.type === 'choices' ? `choices:${n.selected}` : `picked:${n.i}:${n.hidden}`));

describe('整段事件的选项分支', () => {
  for (const at of [2, undefined]) {
    it(`默认显示第一个选项，其他选项下的词条隐藏（${at === undefined ? '旧数据推断' : '带指令下标'}）`, () => {
      expect(shape(buildScene(scene(at), {}))).toEqual(['a', 'choices:1', 'picked:1:1', 'y1', 'head:if', 'y2', 'z']);
      expect(shape(buildScene(scene(at), { '2': 2 }))).toEqual(['a', 'choices:2', 'picked:2:2', 'n1', 'z']);
    });
  }

  it('当前词条在某个选项下时切换到该选项', () => {
    expect(selectionFor(scene(2), 'n1')).toEqual({ '2': 2 });
    expect(selectionFor(scene(2), 'a')).toEqual({});
  });
});
