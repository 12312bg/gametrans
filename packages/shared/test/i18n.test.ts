import { describe, expect, it } from 'vitest';
import { MESSAGES, formatActivity, formatContext, normalizeGamePath, resolveLocale, translate } from '../src';
import type { Engine } from '../src';

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe('i18n', () => {
  it('各语言的键与占位符一致', () => {
    const zh = MESSAGES['zh-CN'];
    for (const [locale, messages] of Object.entries(MESSAGES)) {
      expect(Object.keys(messages).sort(), locale).toEqual(Object.keys(zh).sort());
      for (const k of Object.keys(zh)) expect(placeholders(messages[k]), `${locale} ${k}`).toEqual(placeholders(zh[k]));
    }
  });

  it('解析 Accept-Language', () => {
    expect(resolveLocale('en-US,en;q=0.9')).toBe('en');
    expect(resolveLocale('zh-TW,zh;q=0.9')).toBe('zh-CN');
    expect(resolveLocale('fr-FR, en;q=0.5')).toBe('en');
    expect(resolveLocale('fr')).toBeUndefined();
    expect(resolveLocale(undefined)).toBeUndefined();
  });

  it('插值与回退', () => {
    expect(translate('en', 'error.TOKEN_LIMIT', { max: 20 })).toContain('20');
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
  });

  it('位置说明与动态渲染', () => {
    const t = (k: string, p?: Record<string, string | number>) => translate('zh-CN', k, p);
    const ctx = formatContext(
      [
        { k: 'ctx.plugin', p: { name: 'Foo' } },
        { k: 'ctx.pluginParam', p: { name: 'Items' } },
        { k: 'ctx.subIndex', p: { n: 1 } },
        { k: 'ctx.sub', p: { name: 'label' } },
      ],
      t,
    );
    expect(ctx).toBe('插件 Foo · 参数「Items」 › #1 › label');
    expect(formatActivity({ type: 'member.role', params: { name: '小李', role: 'REVIEWER' } }, t)).toBe('将 小李 的角色改为审核员');
    expect(formatActivity({ type: 'x', params: null, message: '旧文本' }, t)).toBe('旧文本');
  });
});

describe('normalizeGamePath', () => {
  it.each([
    ['MyGame/www/data/Map001.json', 'RMMV', 'www/data/Map001.json'],
    ['MyGame/data/Map001.json', 'RMMZ', 'data/Map001.json'],
    ['MyGame/js/plugins.js', 'RMMZ', 'js/plugins.js'],
    ['MyGame/www/js/plugins.js', 'RMMV', 'www/js/plugins.js'],
    ['MyGame/js/plugins/Foo.js', 'RMMZ', null],
    ['MyGame/img/a.json', 'RMMZ', null],
    ['Map002.json', 'RMMZ', 'data/Map002.json'],
    ['Game/Data/Map001.rvdata2', 'RMVXACE', 'Data/Map001.rvdata2'],
    ['Game/data/Actors.rxdata', 'RMXP', 'Data/Actors.rxdata'],
    ['Game\\Data\\Actors.rvdata', 'RMVX', 'Data/Actors.rvdata'],
    ['Game/Data/Actors.rvdata', 'RMVXACE', null],
    ['__MACOSX/Data/Map001.rvdata2', 'RMVXACE', null],
    ['Game/Data/../x.rvdata2', 'RMVXACE', null],
  ] as [string, Engine, string | null][])('%s (%s)', (input, engine, expected) => {
    expect(normalizeGamePath(input, engine)).toBe(expected);
  });
});
