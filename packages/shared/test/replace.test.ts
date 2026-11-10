import { describe, expect, it } from 'vitest';
import { buildMatcher, replaceWithSegments } from '../src';

describe('批量替换', () => {
  it('普通文本：不区分大小写，$ 不被当作分组引用', () => {
    const re = buildMatcher({ find: '\\n<Lucy>' })!;
    const r = replaceWithSegments('\\n<Lucy>你好\\N<lucy>', re, { replace: '\\n<露西>$1' });
    expect(r.result).toBe('\\n<露西>$1你好\\n<露西>$1');
    expect(r.count).toBe(2);
    expect(r.before.filter((s) => s.changed).map((s) => s.text)).toEqual(['\\n<Lucy>', '\\N<lucy>']);
  });

  it('区分大小写', () => {
    const re = buildMatcher({ find: 'Lucy', caseSensitive: true })!;
    expect(replaceWithSegments('Lucy lucy', re, { replace: '露西' }).result).toBe('露西 lucy');
  });

  it('正则与分组引用', () => {
    const re = buildMatcher({ find: '(\\d+)G', regex: true })!;
    expect(replaceWithSegments('价格 50G、100G', re, { replace: '$1 金币', regex: true }).result).toBe('价格 50 金币、100 金币');
  });

  it('无效或会匹配空字符串的表达式', () => {
    expect(buildMatcher({ find: '(', regex: true })).toBeNull();
    expect(buildMatcher({ find: 'x*', regex: true })).toBeNull();
    expect(buildMatcher({ find: '' })).toBeNull();
  });

  it('替换为空即删除', () => {
    const re = buildMatcher({ find: '～' })!;
    const r = replaceWithSegments('好～的～', re, { replace: '' });
    expect(r.result).toBe('好的');
    expect(r.after.every((s) => !s.changed)).toBe(true);
  });
});
