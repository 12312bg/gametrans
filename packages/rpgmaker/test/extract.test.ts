import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Engine } from '@gametrans/shared';
import { describe, expect, it } from 'vitest';
import { applyTranslations, extractEntries, findRubyStrings, normalizeGamePath } from '../src';

const rgss = (f: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'rgss', f)));
const mz = (f: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'mz', f)));

/** 给每个词条加上前缀作为“译文”，回写后重新提取，校验文本与键都正确 */
function roundTrip(path: string, bytes: Uint8Array, engine: Engine) {
  const before = extractEntries(path, bytes, engine);
  const translations = new Map(before.entries.map((e) => [e.key, `译:${e.original}`]));
  const { data, applied } = applyTranslations(path, bytes, engine, translations);
  const after = extractEntries(path, data, engine);
  return { before, after, applied, data };
}

describe.each([
  ['RMXP', 'rxdata'],
  ['RMVX', 'rvdata'],
  ['RMVXACE', 'rvdata2'],
] as [Engine, string][])('%s', (engine, ext) => {
  const files = ['Map001', 'CommonEvents', 'Troops', 'Actors', 'Items', 'Skills', 'States', 'System', 'Scripts'];

  it('地图：对话合并、选项、改名、脚本', () => {
    const { entries } = extractEntries(`Data/Map001.${ext}`, rgss(`Map001.${ext}`), engine);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    const dialogue = entries.find((e) => e.category === 'dialogue')!;
    if (engine === 'RMXP') {
      expect(dialogue.original).toBe('こんにちは、旅の人。\nこの村へようこそ！');
    } else {
      expect(dialogue.original).toBe('こんにちは、旅の人。\n\\C[2]この村\\C[0]へようこそ！');
      expect(dialogue.context).toContain('脸图 Actor1');
    }
    expect(entries.filter((e) => e.category === 'choice').map((e) => e.original)).toEqual(['はい', 'いいえ']);
    expect(entries.find((e) => e.category === 'name')?.original).toBe('アレックス');
    const script = entries.find((e) => e.category === 'script')!;
    expect(script.danger).toBe(true);
    expect(script.original).toBe('$game_variables[1] = "スクリプト"\np 1');
    expect(entries.some((e) => e.original === '開発者コメント')).toBe(false);
    expect(byKey['events/1/pages/1/list/0']?.original).toBe('また来てね。');
    if (engine === 'RMVXACE') {
      expect(byKey.display_name.original).toBe('はじまりの村');
      expect(entries.find((e) => e.category === 'scroll')?.original).toBe('遠い昔……\nある王国があった。');
    }
  });

  for (const f of files) {
    it(`回写往返：${f}`, () => {
      const path = `Data/${f}.${ext}`;
      const { before, after, applied } = roundTrip(path, rgss(`${f}.${ext}`), engine);
      expect(before.entries.length).toBeGreaterThan(0);
      expect(applied).toBe(before.entries.length);
      expect(after.entries.map((e) => e.key)).toEqual(before.entries.map((e) => e.key));
      for (let i = 0; i < before.entries.length; i++) {
        const b = before.entries[i];
        const a = after.entries[i];
        // 多行对话每行都会带上前缀，这里只比较整体
        if (b.category === 'script' && f === 'Scripts') {
          expect(a.original.replace(/\\(["'])/g, '$1')).toBe(`译:${b.original}`.replace(/\\(["'])/g, '$1'));
        } else {
          expect(a.original).toBe(`译:${b.original}`);
        }
      }
    });
  }

  it('对话行数增减时插入/删除续行指令', () => {
    const path = `Data/Map001.${ext}`;
    const bytes = rgss(`Map001.${ext}`);
    const { entries } = extractEntries(path, bytes, engine);
    const d = entries.find((e) => e.category === 'dialogue')!;
    const more = applyTranslations(path, bytes, engine, new Map([[d.key, '一\n二\n三\n四']])).data;
    expect(extractEntries(path, more, engine).entries.find((e) => e.key === d.key)?.original).toBe('一\n二\n三\n四');
    const less = applyTranslations(path, bytes, engine, new Map([[d.key, '只有一行']])).data;
    const after = extractEntries(path, less, engine).entries;
    expect(after.find((e) => e.key === d.key)?.original).toBe('只有一行');
    // 后续词条的键不受影响
    expect(after.filter((e) => e.category === 'choice').map((e) => e.original)).toEqual(['はい', 'いいえ']);
  });

  it('选项译文同步写入「选择时」分支', () => {
    const path = `Data/Map001.${ext}`;
    const bytes = rgss(`Map001.${ext}`);
    const { entries } = extractEntries(path, bytes, engine);
    const yes = entries.find((e) => e.category === 'choice' && e.original === 'はい')!;
    const out = applyTranslations(path, bytes, engine, new Map([[yes.key, '是']])).data;
    expect(Buffer.from(out).includes(Buffer.from('是'))).toBe(true);
    // 102 的选项 + 402 分支各一处
    expect(Buffer.from(out).toString('utf8').split('是').length - 1).toBe(2);
  });

  it('无译文时输出与原文件字节一致', () => {
    for (const f of files) {
      const bytes = rgss(`${f}.${ext}`);
      const { data } = applyTranslations(`Data/${f}.${ext}`, bytes, engine, new Map());
      expect(Buffer.from(data).equals(Buffer.from(bytes))).toBe(true);
    }
  });
});

describe('RGSS 系统与脚本', () => {
  it('Ace 系统用语', () => {
    const { entries } = extractEntries('Data/System.rvdata2', rgss('System.rvdata2'), 'RMVXACE');
    const keys = entries.map((e) => e.key);
    expect(keys).toContain('game_title');
    expect(keys).toContain('terms/basic/0');
    expect(keys).toContain('terms/commands/3');
    expect(keys).not.toContain('terms/commands/2');
    expect(keys).toContain('elements/1');
  });

  it('XP 系统用语（@words）', () => {
    const { entries } = extractEntries('Data/System.rxdata', rgss('System.rxdata'), 'RMXP');
    expect(entries.find((e) => e.key === 'words/gold')?.original).toBe('G');
    expect(entries.find((e) => e.key === 'elements/1')?.original).toBe('炎');
  });

  it('脚本字符串字面量识别', () => {
    const { entries } = extractEntries('Data/Scripts.rvdata2', rgss('Scripts.rvdata2'), 'RMVXACE');
    const texts = entries.map((e) => e.original);
    expect(texts).toContain('購入する');
    expect(texts).toContain('売却する');
    expect(texts).toContain('%sは %s のダメージを受けた！');
    expect(texts).toContain('#{$data_system ? "x" : \'y\'}は逃げ出した！');
    expect(texts).toContain('彼は\\"こんにちは\\"と言った');
    expect(texts).toContain('あいう');
    expect(texts).toContain('%d歩');
    expect(texts).toContain("It\\'s ok");
    expect(texts).toContain('"');
    // 注释、=begin 块、正则、%w、heredoc 中的内容不应出现
    expect(texts).not.toContain('not a string');
    expect(texts).not.toContain('this is a block comment');
    expect(texts).not.toContain('heredoc text');
    expect(texts.some((t) => t.includes('"c'))).toBe(false);
    expect(entries.every((e) => e.danger && e.category === 'script')).toBe(true);
  });

  it('脚本译文中的引号自动转义', () => {
    const path = 'Data/Scripts.rvdata2';
    const bytes = rgss('Scripts.rvdata2');
    const { entries } = extractEntries(path, bytes, 'RMVXACE');
    const e = entries.find((x) => x.original === '購入する')!;
    const s = entries.find((x) => x.original === '売却する')!;
    const out = applyTranslations(path, bytes, 'RMVXACE', new Map([[e.key, '买"入'], [s.key, "卖'出"]])).data;
    const after = extractEntries(path, out, 'RMVXACE').entries;
    expect(after.find((x) => x.key === e.key)?.original).toBe('买\\"入');
    expect(after.find((x) => x.key === s.key)?.original).toBe("卖\\'出");
  });

  it('lexer 单元', () => {
    const code = [
      'a = "x" # "comment"',
      "b = 'y' / 2",
      'c = d / e / "z"',
      'f = gsub(/["\']/, "w")',
      "g = %Q(#{h}) + 'v'",
      '$" << "u"',
    ].join('\n');
    expect(findRubyStrings(code).map((l) => l.content)).toEqual(['x', 'y', 'z', 'w', 'v', 'u']);
  });
});

describe('MV/MZ', () => {
  const engine: Engine = 'RMMZ';

  it('地图提取', () => {
    const { entries } = extractEntries('data/Map001.json', mz('Map001.json'), engine);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(byKey.displayName.original).toBe('はじまりの村');
    expect(byKey.note.danger).toBe(true);
    expect(byKey['events/1/pages/0/list/0/speaker'].original).toBe('リード');
    expect(byKey['events/1/pages/0/list/0'].original).toBe('こんにちは、旅の人。\n\\C[2]この村\\C[0]へようこそ！');
    expect(byKey['events/1/pages/0/list/3/0'].original).toBe('はい');
    expect(byKey['events/1/pages/0/list/11'].category).toBe('scroll');
    expect(byKey['events/1/pages/0/list/15'].category).toBe('plugin');
    expect(byKey['events/1/pages/0/list/16/text'].original).toBe('プラグインの文字');
    expect(byKey['events/1/pages/0/list/16/list/0'].original).toBe('一');
    expect(byKey['events/1/pages/0/list/16/struct/title'].original).toBe('題名');
    expect(byKey['events/1/pages/0/list/16/count']).toBeUndefined();
    expect(byKey['events/1/pages/1/list/0'].original).toBe('またね');
  });

  for (const f of ['Map001.json', 'Actors.json', 'Items.json', 'CommonEvents.json', 'Troops.json', 'System.json', 'plugins.js']) {
    const path = f === 'plugins.js' ? 'js/plugins.js' : `data/${f}`;
    it(`回写往返：${f}`, () => {
      const { before, after, applied } = roundTrip(path, mz(f), engine);
      expect(before.entries.length).toBeGreaterThan(0);
      expect(applied).toBe(before.entries.length);
      expect(after.entries.map((e) => [e.key, e.original])).toEqual(before.entries.map((e) => [e.key, `译:${e.original}`]));
    });

    it(`无译文时保持原排版：${f}`, () => {
      const bytes = mz(f);
      const { data } = applyTranslations(path, bytes, engine, new Map());
      expect(Buffer.from(data).toString('utf8')).toBe(Buffer.from(bytes).toString('utf8'));
    });
  }

  it('插件参数嵌套 JSON 回写', () => {
    const { entries } = extractEntries('js/plugins.js', mz('plugins.js'), engine);
    const label = entries.find((e) => e.original === '開始')!;
    expect(label.key).toBe('TitleCommand/Items/0/label');
    const out = applyTranslations('js/plugins.js', mz('plugins.js'), engine, new Map([[label.key, '开始']])).data;
    const text = Buffer.from(out).toString('utf8');
    expect(text).toContain('开始');
    expect(text.startsWith('// Generated by RPG Maker.')).toBe(true);
  });
});

describe('路径规范化', () => {
  it.each([
    ['MyGame/www/data/Map001.json', 'RMMV', 'www/data/Map001.json'],
    ['MyGame/data/Map001.json', 'RMMZ', 'data/Map001.json'],
    ['MyGame/js/plugins.js', 'RMMZ', 'js/plugins.js'],
    ['MyGame/js/plugins/Foo.js', 'RMMZ', null],
    ['MyGame/img/a.json', 'RMMZ', null],
    ['Map002.json', 'RMMZ', 'data/Map002.json'],
    ['Game/Data/Map001.rvdata2', 'RMVXACE', 'Data/Map001.rvdata2'],
    ['Game/data/Actors.rxdata', 'RMXP', 'Data/Actors.rxdata'],
    ['Game/Data/Actors.rvdata', 'RMVXACE', null],
    ['__MACOSX/Data/Map001.rvdata2', 'RMVXACE', null],
  ] as [string, Engine, string | null][])('%s (%s)', (input, engine, expected) => {
    expect(normalizeGamePath(input, engine)).toBe(expected);
  });
});
