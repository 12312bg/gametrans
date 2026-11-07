import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marshal } from '../src';

const dir = join(__dirname, 'fixtures', 'rgss');
const files = readdirSync(dir).filter((f) => /\.(rxdata|rvdata2?)$/.test(f));

describe('Ruby Marshal 往返', () => {
  it('fixtures 存在', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const f of files) {
    it(`load → dump 字节一致：${f}`, () => {
      const buf = new Uint8Array(readFileSync(join(dir, f)));
      const v = marshal.load(buf);
      const out = marshal.dump(v);
      expect(Buffer.from(out).equals(Buffer.from(buf))).toBe(true);
    });
  }

  it('保留对象引用（同一字符串被引用两次）', () => {
    const buf = new Uint8Array(readFileSync(join(dir, 'Map001.rvdata2')));
    const map = marshal.load(buf) as marshal.RObject;
    const events = map.get('events') as marshal.RHash;
    const ev = events.get(1) as marshal.RObject;
    const list = (ev.get('pages') as marshal.RObject[])[0].get('list') as marshal.RObject[];
    const shared = list.filter((c) => c.get('code') === 117).map((c) => (c.get('parameters') as marshal.RValue[])[0]);
    expect(shared).toHaveLength(2);
    expect(shared[0]).toBe(shared[1]);
  });

  it('long 编码边界', () => {
    for (const n of [0, 1, 122, 123, 255, 256, -1, -123, -124, -256, -257, 65535, 65536, -65536, 2 ** 30 - 1, -(2 ** 30)]) {
      const v = marshal.load(marshal.dump(n));
      expect(v).toBe(n);
    }
  });

  it('修改字符串后保留编码标记', () => {
    const s = marshal.RString.fromText('テスト', [['E', true]]);
    const back = marshal.load(marshal.dump([s, s])) as marshal.RString[];
    expect(back[0].text).toBe('テスト');
    expect(back[0]).toBe(back[1]);
    expect(back[0].meta?.ivars).toEqual([['E', true]]);
  });
});
