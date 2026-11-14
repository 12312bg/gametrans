import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEntries } from '../src';

const cmd = (code: number, indent: number, parameters: unknown[] = []) => ({ code, indent, parameters });
const text = (indent: number, line: string) => [cmd(101, indent, ['', 0, 0, 2, '']), cmd(401, indent, [line])];

function mapWith(list: unknown[]) {
  const ev = { id: 1, name: 'EV', note: '', x: 0, y: 0, pages: [{ list }] };
  return new TextEncoder().encode(JSON.stringify({ displayName: '', note: '', events: [null, ev] }));
}

describe('事件分支路径', () => {
  it('记录选项、条件分支与否则，分支结束后恢复', () => {
    const list = [
      ...text(0, 'Hello'),
      cmd(102, 0, [['Accept', 'Refuse'], 1, 0, 2, 0]),
      cmd(402, 0, [0, 'Accept']),
      ...text(1, 'Great'),
      cmd(111, 1, [0, 12, 0]),
      ...text(2, 'Switch on'),
      cmd(0, 2),
      cmd(411, 1),
      ...text(2, 'Switch off'),
      cmd(0, 2),
      cmd(412, 1),
      cmd(0, 1),
      cmd(402, 0, [1, 'Refuse']),
      ...text(1, 'Too bad'),
      cmd(0, 1),
      cmd(404, 0),
      ...text(0, 'Bye'),
      cmd(0, 0),
    ];
    const { entries } = extractEntries('data/Map001.json', mapWith(list), 'RMMV');
    const by = (s: string) => entries.find((e) => e.original === s)?.branch;
    expect(by('Hello')).toBeUndefined();
    expect(by('Great')).toEqual([{ k: 'choice', i: 1, text: 'Accept' }]);
    expect(by('Switch on')).toEqual([{ k: 'choice', i: 1, text: 'Accept' }, { k: 'if', type: 0, args: [12, 0] }]);
    expect(by('Switch off')).toEqual([{ k: 'choice', i: 1, text: 'Accept' }, { k: 'else', type: 0, args: [12, 0] }]);
    expect(by('Too bad')).toEqual([{ k: 'choice', i: 2, text: 'Refuse' }]);
    expect(by('Bye')).toBeUndefined();
    // 选项本身不在分支内
    expect(entries.find((e) => e.original === 'Accept')?.branch).toBeUndefined();
  });

  it('XP / VX / Ace 的事件同样记录分支（不报错）', () => {
    const dir = join(__dirname, 'fixtures', 'rgss');
    const files = readdirSync(dir).filter((f) => /^Map\d+\.(rxdata|rvdata2?)$/.test(f));
    let branched = 0;
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const engine = f.endsWith('.rxdata') ? 'RMXP' : f.endsWith('.rvdata2') ? 'RMVXACE' : 'RMVX';
      const { entries } = extractEntries(`Data/${f}`, readFileSync(join(dir, f)), engine);
      branched += entries.filter((e) => e.branch?.length).length;
    }
    expect(branched).toBeGreaterThan(0);
  });
});
