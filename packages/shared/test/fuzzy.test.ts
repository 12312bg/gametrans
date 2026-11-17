import { describe, expect, it } from 'vitest';
import { diffSegments, fuzzyMatch } from '../src/domain/fuzzy';

describe('fuzzyMatch', () => {
  it('完全相同（忽略换行风格与大小写）', () => {
    expect(fuzzyMatch('Hello\r\nWorld', 'hello\nworld')).toMatchObject({ score: 1, rank: 1, kind: 'exact' });
  });

  it('中间片段相同的长句也能得到较高排序分', () => {
    const r = fuzzyMatch('勇者の剣', 'あなたは勇者の剣を持っている');
    expect(r.kind).toBe('contains');
    expect(r.score).toBeLessThan(0.4);
    expect(r.rank).toBeGreaterThan(0.6);
  });

  it('当前原文包含候选', () => {
    expect(fuzzyMatch('ついに伝説の勇者の剣を手に入れたぞ', '勇者の剣を手に入れた').kind).toBe('contained');
  });

  it('整体相似（只差一个字）', () => {
    const r = fuzzyMatch('勇者は伝説の剣を手に入れた！', '勇者は伝説の盾を手に入れた！');
    expect(r.kind).toBe('similar');
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('中间有一大段相同、前后不同：partial', () => {
    const r = fuzzyMatch('村長：伝説の剣を探してくれ', '王様「伝説の剣を探してくれないか」');
    expect(r.kind).toBe('partial');
    expect(r.rank).toBeGreaterThan(0.45);
  });

  it('无关文本分数很低', () => {
    expect(fuzzyMatch('こんにちは', '宿屋に泊まりますか？').rank).toBeLessThan(0.3);
  });
});

describe('diffSegments', () => {
  it('标出不同的部分', () => {
    expect(diffSegments('勇者は伝説の剣を手に入れた！', '勇者は伝説の盾を手に入れた！')).toEqual([
      { text: '勇者は伝説の', same: true },
      { text: '盾', same: false },
      { text: 'を手に入れた！', same: true },
    ]);
  });

  it('候选包含当前原文时，多出的前后文为差异', () => {
    expect(diffSegments('勇者の剣', 'あなたは勇者の剣を持っている')).toEqual([
      { text: 'あなたは', same: false },
      { text: '勇者の剣', same: true },
      { text: 'を持っている', same: false },
    ]);
  });

  it('拼接后还原为候选原文', () => {
    const b = 'Please open the door quickly';
    expect(diffSegments('Open the door', b).map((s) => s.text).join('')).toBe(b);
  });
});
