import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatContext, hasMessage, translate } from '@gametrans/shared';
import type { ContextPart, Engine } from '@gametrans/shared';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UnsupportedFileError, applyTranslations, escapeJsString, extractEntries, findJsStrings, findRubyStrings } from '../src';

const zh = (parts: ContextPart[]) => formatContext(parts, (k, p) => translate('zh-CN', k, p));
const en = (parts: ContextPart[]) => formatContext(parts, (k, p) => translate('en', k, p));

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
  const files = ['Map001', 'MapInfos', 'CommonEvents', 'Troops', 'Actors', 'Items', 'Skills', 'States', 'System', 'Scripts'];

  it('地图：对话合并、选项、改名、脚本', () => {
    const { entries } = extractEntries(`Data/Map001.${ext}`, rgss(`Map001.${ext}`), engine);
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    const dialogue = entries.find((e) => e.category === 'dialogue')!;
    if (engine === 'RMXP') {
      expect(dialogue.original).toBe('こんにちは、旅の人。\nこの村へようこそ！');
    } else {
      expect(dialogue.original).toBe('こんにちは、旅の人。\n\\C[2]この村\\C[0]へようこそ！');
      expect(zh(dialogue.context)).toBe('Map001 · 事件 #1「村人A」(3,4) · 第1页 · 显示文章（脸图 Actor1(0)）');
      expect(en(dialogue.context)).toBe('Map001 · Event #1 "村人A" (3,4) · Page 1 · Show Text (face Actor1(0))');
    }
    expect(entries.filter((e) => e.category === 'choice').map((e) => e.original)).toEqual(['はい', 'いいえ']);
    expect(entries.find((e) => e.category === 'name')?.original).toBe('アレックス');
    // 事件脚本、条件分支脚本、控制变量脚本（仅 Ace）中的字符串逐个提取；XP / VX 的操作数 4 是角色
    const scripts = entries.filter((e) => e.category === 'script');
    expect(scripts.every((e) => e.danger)).toBe(true);
    expect(scripts.map((e) => e.original)).toEqual(engine === 'RMVXACE' ? ['スクリプト', 'Normal', 'Normal'] : ['スクリプト', 'Normal']);
    expect(zh(scripts[0].context)).toMatch(/事件脚本 · 第1行$/);
    expect(zh(scripts[1].context)).toMatch(/条件分支（脚本） · \$game_variables\[3\] == "Normal"$/);
    if (engine === 'RMVXACE') expect(zh(scripts[2].context)).toMatch(/控制变量 #3（脚本） · 'Normal'$/);
    // 注释也提取（默认隐藏），有插件会显示注释中的文字
    expect(entries.find((e) => e.original === '開発者コメント')).toMatchObject({ category: 'comment', danger: true });
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
        if (b.category === 'script') {
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
    expect(byKey['events/1/pages/0/list/16'].category).toBe('plugin');
    expect(byKey['events/1/pages/0/list/17/text'].original).toBe('プラグインの文字');
    expect(byKey['events/1/pages/0/list/17/list/0'].original).toBe('一');
    expect(byKey['events/1/pages/0/list/17/struct/title'].original).toBe('題名');
    expect(byKey['events/1/pages/0/list/17/count']).toBeUndefined();
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

describe('结构化位置说明与错误码', () => {
  const all: [string, Uint8Array, Engine][] = [
    ...readdirSync(join(__dirname, 'fixtures', 'rgss'))
      .filter((f) => /\.(rxdata|rvdata2?)$/.test(f))
      .map((f): [string, Uint8Array, Engine] => [`Data/${f}`, rgss(f), f.endsWith('rxdata') ? 'RMXP' : f.endsWith('rvdata') ? 'RMVX' : 'RMVXACE']),
    ...readdirSync(join(__dirname, 'fixtures', 'mz'))
      .filter((f) => /\.(json|js)$/.test(f))
      .map((f): [string, Uint8Array, Engine] => [f === 'plugins.js' ? 'js/plugins.js' : `data/${f}`, mz(f), 'RMMZ']),
  ];

  it('所有位置说明的键都在语言包中', () => {
    for (const [path, bytes, engine] of all) {
      for (const e of extractEntries(path, bytes, engine).entries) {
        for (const part of e.context) expect(hasMessage(part.k), `${path} ${e.key} ${part.k}`).toBe(true);
      }
    }
  });

  it('MZ 姓名框与插件参数', () => {
    const { entries } = extractEntries('data/Map001.json', mz('Map001.json'), 'RMMZ');
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e]));
    expect(zh(byKey['events/1/pages/0/list/0'].context)).toContain('显示文章（脸图 Actor1(0) · 说话人 リード）');
    expect(zh(byKey['events/1/pages/0/list/17/struct/title'].context)).toBe(
      'Map001 · 事件 #1「村人A」(3,4) · 第1页 · 插件指令 TextPlugin:show · 参数「struct」 › title',
    );
    const { entries: plugins } = extractEntries('js/plugins.js', mz('plugins.js'), 'RMMZ');
    expect(en(plugins.find((e) => e.original === '開始')!.context)).toBe('Plugin TitleCommand · Parameter "Items" › #1 › label');
  });

  it('脚本位置说明', () => {
    const { entries } = extractEntries('Data/Scripts.rvdata2', rgss('Scripts.rvdata2'), 'RMVXACE');
    expect(zh(entries.find((e) => e.original === '購入する')!.context)).toBe('脚本 #0「Vocab」 · 第6行');
  });

  it('无法解析的文件抛出带错误码的异常', () => {
    const codeOf = (fn: () => unknown): [string, unknown] | undefined => {
      try {
        fn();
      } catch (e) {
        if (e instanceof UnsupportedFileError) return [e.code, e.params];
        throw e;
      }
      return undefined;
    };
    expect(codeOf(() => extractEntries('data/Map001.json', new TextEncoder().encode('{bad'), 'RMMZ'))?.[0]).toBe('JSON_INVALID');
    expect(codeOf(() => extractEntries('Data/Map001.rvdata2', new Uint8Array([4, 8, 0xff]), 'RMVXACE'))?.[0]).toBe('MARSHAL_INVALID');
    expect(codeOf(() => extractEntries('Data/Map001.rxdata', rgss('Map001.rvdata2'), 'RMVXACE'))).toEqual(['WRONG_EXTENSION', { ext: '.rvdata2' }]);
    expect(codeOf(() => extractEntries('js/foo.js', new Uint8Array(), 'RMMZ'))?.[0]).toBe('MVMZ_UNSUPPORTED');
    expect(codeOf(() => extractEntries('js/plugins.js', new TextEncoder().encode('var x = 1;'), 'RMMZ'))?.[0]).toBe('PLUGINS_NOT_FOUND');
  });
});

describe('事件脚本字符串与变量名', () => {
  it('MZ：事件脚本、条件分支、控制变量中的字符串逐个提取', () => {
    const { entries } = extractEntries('data/Map001.json', mz('Map001.json'), 'RMMZ');
    const scripts = entries.filter((e) => e.category === 'script');
    expect(scripts.map((e) => e.original)).toEqual(['テキスト', 'Normal', 'Normal']);
    expect(scripts.every((e) => e.danger)).toBe(true);
    expect(en(scripts[1].context)).toMatch(/Control Variables #3 \(script\) · "Normal"$/);
    expect(en(scripts[2].context)).toMatch(/Conditional Branch \(script\) · \$gameVariables\.value\(3\) === "Normal"$/);
  });

  it('MZ：回写只替换引号内的内容并转义', () => {
    const path = 'data/Map001.json';
    const bytes = mz('Map001.json');
    const scripts = extractEntries(path, bytes, 'RMMZ').entries.filter((e) => e.category === 'script');
    const tr = new Map([
      [scripts[0].key, 'テ\nキ'],
      [scripts[1].key, '普通"难'],
      [scripts[2].key, '普通"难'],
    ]);
    const map = JSON.parse(Buffer.from(applyTranslations(path, bytes, 'RMMZ', tr).data).toString('utf8'));
    const list = map.events[1].pages[0].list as { code: number; parameters: unknown[] }[];
    const params = (code: number) => list.find((c) => c.code === code)!.parameters;
    expect(params(355)[0]).toBe('$gameVariables.setValue(1, "テ\\nキ");');
    expect(params(655)[0]).toBe("// 注释里的 'x' 不提取");
    expect(params(122)[4]).toBe('"普通\\"难"');
    expect(params(111)[1]).toBe('$gameVariables.value(3) === "普通\\"难"');
  });

  it('Ace：译文换行时事件脚本增加续行指令', () => {
    const path = 'Data/Map001.rvdata2';
    const bytes = rgss('Map001.rvdata2');
    const e = extractEntries(path, bytes, 'RMVXACE').entries.find((x) => x.original === 'スクリプト')!;
    const out = applyTranslations(path, bytes, 'RMVXACE', new Map([[e.key, '第一行\n第二行']])).data;
    const after = extractEntries(path, out, 'RMVXACE').entries;
    expect(after.find((x) => x.key === e.key)?.original).toBe('第一行\n第二行');
    expect(after.filter((x) => x.category === 'script')).toHaveLength(3);
  });

  it('变量 / 开关名称默认隐藏', () => {
    const check = (entries: { key: string; original: string; category: string; danger: boolean }[], variable: string) => {
      expect(entries.find((e) => e.key === 'variables/1')).toMatchObject({ original: variable, category: 'variable', danger: true });
      expect(entries.find((e) => e.key === 'switches/1')).toMatchObject({ original: 'スイッチ1', category: 'variable', danger: true });
    };
    const mzSys = extractEntries('data/System.json', mz('System.json'), 'RMMZ').entries;
    check(mzSys, '変数1');
    expect(zh(mzSys.find((e) => e.key === 'variables/1')!.context)).toBe('系统 · 变量 #1');
    for (const [engine, ext] of [['RMXP', 'rxdata'], ['RMVX', 'rvdata'], ['RMVXACE', 'rvdata2']] as [Engine, string][]) {
      const entries = extractEntries(`Data/System.${ext}`, rgss(`System.${ext}`), engine).entries;
      check(entries, '難易度');
      expect(entries.some((e) => e.key === 'variables/2')).toBe(false);
    }
  });

  it('JS lexer 单元', () => {
    const code = [
      "var a = 'x'; // 'comment'",
      'b = c / 2 + "y" / 3;',
      "d = /[\"']/.test(e) ? `z` : `t${f}`;",
      '/* "block" */ g("w\\"q");',
    ].join('\n');
    const found = findJsStrings(code);
    expect(found.map((l) => l.content)).toEqual(['x', 'y', 'z', 'w\\"q']);
    expect(found.map((l) => l.line)).toEqual([1, 2, 3, 4]);
  });

  it('JS 字符串转义', () => {
    expect(escapeJsString('a"b\nc', '"')).toBe('a\\"b\\nc');
    expect(escapeJsString("it's", "'")).toBe("it\\'s");
    expect(escapeJsString('a\\"b', '"')).toBe('a\\"b');
    expect(escapeJsString('x\\', '"')).toBe('x\\\\');
    expect(escapeJsString('${x}`', '`')).toBe('\\${x}\\`');
  });
});

describe('注释与公共事件名', () => {
  it('MZ：逐行提取注释，跳过标签行与无文字的行，注明所在标签块', () => {
    const { entries } = extractEntries('data/CommonEvents.json', mz('CommonEvents.json'), 'RMMZ');
    const comments = entries.filter((e) => e.category === 'comment');
    expect(comments.map((e) => e.original)).toEqual(['Select your travel destination!', '     - Requirements -', '开发者备注：传送后刷新地图']);
    expect(comments.every((e) => e.danger)).toBe(true);
    expect(comments.map((e) => zh(e.context))).toEqual([
      '公共事件 #2「Return Home」 · 注释 · 标签 <Help Description> · 第2行',
      '公共事件 #2「Return Home」 · 注释 · 标签 <Subtext> · 第5行',
      '公共事件 #2「Return Home」 · 注释 · 第1行',
    ]);
  });

  it('公共事件名默认隐藏', () => {
    const { entries } = extractEntries('data/CommonEvents.json', mz('CommonEvents.json'), 'RMMZ');
    const names = entries.filter((e) => e.category === 'eventName');
    expect(names.map((e) => [e.key, e.original, e.danger])).toEqual([
      ['1/name', '共通', true],
      ['2/name', 'Return Home', true],
    ]);
    expect(en(names[1].context)).toBe('Common event #2 "Return Home" · Name');
    for (const [engine, ext] of [['RMXP', 'rxdata'], ['RMVX', 'rvdata'], ['RMVXACE', 'rvdata2']] as [Engine, string][]) {
      const rg = extractEntries(`Data/CommonEvents.${ext}`, rgss(`CommonEvents.${ext}`), engine).entries;
      expect(rg.find((e) => e.key === '1/name')).toMatchObject({ original: '共通', category: 'eventName' });
      expect(zh(rg.find((e) => e.category === 'comment')!.context)).toContain('标签 <Help Description>');
    }
  });

  it('回写注释只改对应的那一行，标签行不变', () => {
    const path = 'data/CommonEvents.json';
    const bytes = mz('CommonEvents.json');
    const { entries } = extractEntries(path, bytes, 'RMMZ');
    const help = entries.find((e) => e.original === 'Select your travel destination!')!;
    const name = entries.find((e) => e.key === '2/name')!;
    const out = JSON.parse(Buffer.from(applyTranslations(path, bytes, 'RMMZ', new Map([[help.key, '请选择目的地！'], [name.key, '回家']])).data).toString('utf8'));
    const list = out[2].list as { code: number; parameters: string[] }[];
    expect(out[2].name).toBe('回家');
    expect(list.slice(0, 3).map((c) => c.parameters[0])).toEqual(['<Help Description>', '请选择目的地！', '</Help Description>']);
    expect(list.map((c) => c.code)).toEqual(JSON.parse(Buffer.from(bytes).toString('utf8'))[2].list.map((c: { code: number }) => c.code));
  });
});

describe('地图名（MapInfos）', () => {
  // 编辑器的排版：每张地图一行；order 是地图树中的顺序
  const mapInfos = [
    'null',
    '{"id":1,"expanded":false,"name":"West District","order":1,"parentId":0,"scrollX":0,"scrollY":0}',
    '{"id":2,"expanded":false,"name":"Kitchen","order":3,"parentId":3,"scrollX":0,"scrollY":0}',
    '{"id":3,"expanded":true,"name":"Diner","order":2,"parentId":1,"scrollX":0,"scrollY":0}',
    '{"id":4,"expanded":false,"name":"Kitchen","order":4,"parentId":0,"scrollX":0,"scrollY":0}',
    '{"id":5,"expanded":false,"name":"","order":5,"parentId":0,"scrollX":0,"scrollY":0}',
  ];
  const bytes = new TextEncoder().encode(`[\n${mapInfos.join(',\n')}\n]`);

  it('MV/MZ：按地图树顺序提取，默认隐藏，位置说明带上级路径以区分同名地图', () => {
    const { entries, kind } = extractEntries('data/MapInfos.json', bytes, 'RMMV');
    expect(kind).toBe('map_infos');
    expect(entries.map((e) => [e.key, e.original])).toEqual([
      ['1/name', 'West District'],
      ['3/name', 'Diner'],
      ['2/name', 'Kitchen'],
      ['4/name', 'Kitchen'],
    ]);
    expect(entries.every((e) => e.category === 'mapName' && e.danger)).toBe(true);
    expect(entries.map((e) => zh(e.context))).toEqual(['地图 #1', '地图 #3 · 位于 West District', '地图 #2 · 位于 West District / Diner', '地图 #4']);
    expect(en(entries[2].context)).toBe('Map #2 · Under West District / Diner');
  });

  it('MV/MZ：回写只改地图名，保持每张地图一行', () => {
    const { data, applied } = applyTranslations('data/MapInfos.json', bytes, 'RMMV', new Map([['2/name', '厨房'], ['1/name', '西区']]));
    expect(applied).toBe(2);
    const expected = [...mapInfos];
    expected[1] = expected[1].replace('"West District"', '"西区"');
    expected[2] = expected[2].replace('"Kitchen"', '"厨房"');
    expect(Buffer.from(data).toString('utf8')).toBe(`[\n${expected.join(',\n')}\n]`);
  });

  it.each([
    ['RMXP', 'rxdata'],
    ['RMVX', 'rvdata'],
    ['RMVXACE', 'rvdata2'],
  ] as [Engine, string][])('%s：从 { ID => RPG::MapInfo } 中提取', (engine, ext) => {
    const { entries } = extractEntries(`Data/MapInfos.${ext}`, rgss(`MapInfos.${ext}`), engine);
    expect(entries.map((e) => [e.key, e.original, zh(e.context)])).toEqual([
      ['1/name', 'はじまりの村', '地图 #1'],
      ['3/name', '村の家', '地图 #3 · 位于 はじまりの村'],
    ]);
    expect(entries.every((e) => e.category === 'mapName' && e.danger)).toBe(true);
  });
});
