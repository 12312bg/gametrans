import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonChange, applyJsonPatch, applyPreEdit, computePatch, diffJson, editableText, extractEntries, preEditTouchedEntries, prettyJson, sameJson } from '../src';

const mz = (f: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'mz', f)));
const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

describe('JSON 字段补丁', () => {
  it('修改、新增、删除字段；数组长度变化时整体替换', () => {
    const a = { x: 1, y: [1, 2], z: { k: 'a' } };
    const b = { x: 2, y: [1, 2, 3], z: {}, n: true };
    const patch = diffJson(a, b);
    expect(patch).toEqual([
      { path: ['x'], before: 1, after: 2 },
      { path: ['y'], before: [1, 2], after: [1, 2, 3] },
      { path: ['z', 'k'], before: 'a' },
      { path: ['n'], after: true },
    ]);
    expect(applyJsonPatch(structuredClone(a), patch)).toEqual({ value: b, conflicts: [] });
  });

  it('原值已变化时跳过并计入冲突', () => {
    const { value, conflicts } = applyJsonPatch({ x: 5, y: 1 }, [
      { path: ['x'], before: 1, after: 2 },
      { path: ['y'], before: 1, after: 9 },
    ]);
    expect(value).toEqual({ x: 5, y: 9 });
    expect(conflicts).toHaveLength(1);
  });

  it('比较时不计对象键顺序，但数组顺序与类型要一致', () => {
    expect(sameJson({ a: 1, b: [{ x: 1, y: '2' }] }, { b: [{ y: '2', x: 1 }], a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson({ a: '1' }, { a: 1 })).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });

  it('易读格式：短值与基本类型数组保持一行', () => {
    const out = prettyJson({ data: Array.from({ length: 60 }, (_, i) => i), events: [{ id: 1, name: 'a'.repeat(130) }] });
    expect(out.split('\n')[1]).toMatch(/^ {2}"data": \[0,1,2,/);
    expect(out).toContain('    {\n      "id": 1,');
  });
});

describe('数据文件预编辑', () => {
  it('修改未提取的字段：保留原排版，词条不变', () => {
    const bytes = mz('Map001.json');
    const edited = editableText('data/Map001.json', bytes).replace('"battleback1Name": ""', '"battleback1Name": "Grass"');
    const patch = computePatch('data/Map001.json', bytes, edited);
    expect(patch).toEqual([{ path: ['battleback1Name'], before: '', after: 'Grass' }]);
    expect(preEditTouchedEntries('data/Map001.json', bytes, 'RMMZ', patch)).toEqual([]);
    const out = text(applyPreEdit('data/Map001.json', bytes, patch).data);
    expect(out).toBe(text(bytes).replace('"battleback1Name":""', '"battleback1Name":"Grass"'));
  });

  it('改动已提取的词条或增删指令会被拦下', () => {
    const bytes = mz('Map001.json');
    const original = editableText('data/Map001.json', bytes);
    const renamed = computePatch('data/Map001.json', bytes, original.replace('"はじまりの村"', '"新手村"'));
    expect(preEditTouchedEntries('data/Map001.json', bytes, 'RMMZ', renamed)).toEqual([{ key: 'displayName', before: 'はじまりの村', after: '新手村' }]);
    const value = JSON.parse(original);
    value.events[1].pages[0].list.unshift({ code: 230, indent: 0, parameters: [60] });
    const inserted = computePatch('data/Map001.json', bytes, JSON.stringify(value));
    expect(preEditTouchedEntries('data/Map001.json', bytes, 'RMMZ', inserted).length).toBeGreaterThan(0);
  });

  it('plugins.js 只编辑 $plugins 数组，写回保持每行一个插件', () => {
    const bytes = mz('plugins.js');
    const edited = editableText('js/plugins.js', bytes).replace('"Visible": "true"', '"Visible": "false"');
    const patch = computePatch('js/plugins.js', bytes, edited);
    expect(patch).toHaveLength(1);
    expect(preEditTouchedEntries('js/plugins.js', bytes, 'RMMZ', patch)).toEqual([]);
    const out = text(applyPreEdit('js/plugins.js', bytes, patch).data);
    expect(out).toBe(text(bytes).replace('"Visible":"true"', '"Visible":"false"'));
    expect(() => computePatch('js/plugins.js', bytes, '{}')).toThrow('PREEDIT_INVALID_JSON');
  });

  it('补丁经 jsonb 存储（对象键被重排）后仍能应用，并保持原文件的键顺序', () => {
    // PostgreSQL jsonb 按「键长度、再按字节」排列对象键
    const jsonb = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(jsonb)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)).map(([k, x]) => [k, jsonb(x)]))
          : v;
    const bytes = mz('plugins.js');
    const added = '{"name":"Added","status":true,"description":"新插件","parameters":{"Speed":"5"}}';
    const edited = JSON.stringify([...JSON.parse(editableText('js/plugins.js', bytes)), JSON.parse(added)]);
    const patch = jsonb(computePatch('js/plugins.js', bytes, edited)) as JsonChange[];
    expect(patch).toHaveLength(1);
    expect(JSON.stringify(patch)).toContain('"parameters":{},"description":""');

    expect(editableText('js/plugins.js', bytes, patch)).toContain(added);
    const { data, conflicts } = applyPreEdit('js/plugins.js', bytes, patch);
    expect(conflicts).toBe(0);
    expect(text(data)).toBe(text(bytes).replace('"parameters":{}}\n]', `"parameters":{}},\n${added}\n]`));
  });

  it('无效 JSON 与不支持的格式', () => {
    expect(() => computePatch('data/Map001.json', mz('Map001.json'), '{ broken')).toThrow('PREEDIT_INVALID_JSON');
    expect(() => editableText('Data/Map001.rvdata2', new Uint8Array(4))).toThrow('PREEDIT_UNSUPPORTED');
    expect(extractEntries('data/Map001.json', mz('Map001.json'), 'RMMZ').entries.length).toBeGreaterThan(0);
  });
});
