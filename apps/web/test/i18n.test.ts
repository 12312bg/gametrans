import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@gametrans/shared';
import * as sections from '../src/i18n/ui';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
const SRC = join(__dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'ui' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('界面文案', () => {
  const zh = Object.assign({}, ...Object.values(sections).map((s) => s.zh)) as Record<string, string>;
  const en = Object.assign({}, ...Object.values(sections).map((s) => s.en)) as Record<string, string>;
  const all = new Set([...Object.keys(zh), ...Object.keys(MESSAGES['zh-CN'])]);

  it('中英文占位符一致', () => {
    for (const k of Object.keys(zh)) expect(placeholders(en[k]), k).toEqual(placeholders(zh[k]));
  });

  it('各分区与共享文案的键不重复', () => {
    const seen = new Map<string, string>();
    for (const [name, s] of Object.entries(sections)) {
      for (const k of Object.keys(s.zh)) {
        expect(seen.get(k), `${k} 同时出现在 ${seen.get(k)} 和 ${name}`).toBeUndefined();
        expect(k in MESSAGES['zh-CN'], `${k} 与共享文案重复`).toBe(false);
        seen.set(k, name);
      }
    }
  });

  it('代码中引用的文案键都存在', () => {
    const namespaces = new Set([...all].map((k) => k.split('.')[0]));
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, 'utf8');
      // 所有形如 'ns.key' 的字符串字面量（含条件表达式里的键）
      for (const m of code.matchAll(/'([a-z]\w*)\.([\w.]+)'/g)) {
        if (namespaces.has(m[1]) && !all.has(`${m[1]}.${m[2]}`)) missing.push(`${file}: ${m[1]}.${m[2]}`);
      }
      // t(`prefix.${x}`) 只检查前缀
      for (const m of code.matchAll(/`([a-z][\w.]*\.)\$\{/g)) {
        if (namespaces.has(m[1].split('.')[0]) && ![...all].some((k) => k.startsWith(m[1]))) missing.push(`${file}: ${m[1]}*`);
      }
    }
    expect(missing).toEqual([]);
  });
});
