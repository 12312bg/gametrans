import { describe, expect, it } from 'vitest';
import type { ParserConfig } from '@gametrans/shared';
import { analyzeTwineMacros, applyTranslations, extractEntries } from '../src';
import { UnsupportedFileError } from '../src/types';

const enc = new TextEncoder();
const dec = new TextDecoder();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function storyHtml(passages: { name: string; tags?: string; text: string }[], script = '', format = 'SugarCube') {
  const body = passages.map((p, i) => `<tw-passagedata pid="${i + 1}" name="${esc(p.name)}" tags="${p.tags ?? ''}" position="0,0" size="100,100">${esc(p.text)}</tw-passagedata>`).join('');
  return enc.encode(
    `<!DOCTYPE html><html><head><title>Demo</title></head><body>\n` +
      `<tw-storydata name="Demo" startnode="1" creator="Tweego" ifid="X" format="${format}" format-version="2.36.1" options="" hidden>` +
      `<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">body{color:red}</style>` +
      `<script role="script" id="twine-user-script" type="text/twine-javascript">${script}</script>` +
      `${body}</tw-storydata>\n<script>/* engine */ var x = "<<not a macro>>";</script></body></html>`,
  );
}

const STORY = storyHtml(
  [
    {
      name: 'Start',
      text: [
        'You enter the chapel.',
        'Hello, <<print $name>>! You have $gold coins.',
        '[[Go to the hall|Hall]]',
        '[[Library]]',
        'Walk to the [[garden|Garden]] or stay.',
        '<<link "Pray quietly" "Chapel">><<set $faith += 1>><</link>>',
        '<<if $faith > 2>>',
        '  <b>Blessed</b> are you.',
        '<<else>>',
        '  Nothing happens.',
        '<</if>>',
        '<<set $title to "Sister Agnes">>',
        '/* a comment */',
        '<<say ms "I\'d like to \\"help\\" you." ii>>',
        '<div class="box">Inside a box</div>',
        '<<script>>',
        'State.variables.msg = "Saved!";',
        '<</script>>',
      ].join('\n'),
    },
    { name: 'Hall', tags: 'room', text: 'A long & dark hall.\n<<button "Ring the bell">><</button>>' },
    { name: 'StoryCaption', text: 'Day $day' },
    { name: 'StoryMenu', text: '[[Journal]]' },
    { name: 'Styles', tags: 'stylesheet', text: 'body { color: blue; }' },
    { name: 'Widgets', tags: 'widget', text: '<<widget "say">><<print _args[1]>><</widget>>' },
  ],
  'Config.saves.autosave = true;\nsetup.greeting = "Welcome back";',
);

const CONFIG: ParserConfig = { twine: { macros: [{ name: 'say', args: [1], speaker: 0 }] } };

const byOriginal = <T extends { original: string }>(entries: T[], text: string) => entries.find((e) => e.original === text);

describe('Twine（SugarCube）提取', () => {
  it('提取正文、链接、宏参数与脚本字符串', () => {
    const { entries, kind } = extractEntries('index.html', STORY, 'TWINE', CONFIG);
    expect(kind).toBe('story');
    const originals = entries.map((e) => e.original);
    expect(originals).toContain('You enter the chapel.');
    // 行内的宏与变量保留在词条中
    expect(originals).toContain('Hello, <<print $name>>! You have $gold coins.');
    // 单独一行的链接只提取显示文字
    expect(byOriginal(entries, 'Go to the hall')?.category).toBe('choice');
    expect(byOriginal(entries, 'Library')?.context[1]).toEqual({ k: 'ctx.tw.link', p: { target: 'Library', n: 4 } });
    // 句中的 [[目标]] 规范为 [[文字|目标]]
    expect(originals).toContain('Walk to the [[garden|Garden]] or stay.');
    expect(byOriginal(entries, 'Pray quietly')?.category).toBe('choice');
    expect(originals).toContain('<b>Blessed</b> are you.');
    expect(originals).toContain('Nothing happens.');
    expect(originals).toContain('Inside a box');
    expect(originals).toContain('A long & dark hall.');
    expect(originals).toContain('Ring the bell');
    // 自定义宏：说话人 + 台词（转义已还原）
    const say = byOriginal(entries, 'I\'d like to "help" you.');
    expect(say?.context[1]).toEqual({ k: 'ctx.tw.say', p: { macro: 'say', speaker: 'ms', n: 14 } });
    expect(say?.category).toBe('dialogue');
    // 注释、样式段落、纯标记行不提取
    expect(originals.some((o) => o.includes('comment'))).toBe(false);
    expect(originals.some((o) => o.includes('color'))).toBe(false);
  });

  it('脚本字符串默认隐藏，特殊段落归为系统', () => {
    const { entries } = extractEntries('index.html', STORY, 'TWINE', CONFIG);
    const title = byOriginal(entries, 'Sister Agnes');
    expect(title).toMatchObject({ category: 'script', danger: true });
    expect(byOriginal(entries, 'Saved!')).toMatchObject({ category: 'script', danger: true });
    const greeting = byOriginal(entries, 'Welcome back');
    expect(greeting).toMatchObject({ key: 'script/0', category: 'script', danger: true });
    expect(greeting?.context).toEqual([{ k: 'ctx.tw.storyScript', p: { n: 2 } }]);
    expect(byOriginal(entries, 'Day $day')?.category).toBe('system');
    expect(byOriginal(entries, 'Journal')?.category).toBe('choice');
    // 页面上的引擎脚本不属于故事，不提取
    expect(entries.some((e) => e.original.includes('not a macro'))).toBe(false);
  });

  it('键按段落分组，带分支路径', () => {
    const { entries } = extractEntries('index.html', STORY, 'TWINE', CONFIG);
    expect(entries.filter((e) => e.key.startsWith('passages/Start/list/')).length).toBeGreaterThan(8);
    expect(byOriginal(entries, 'Nothing happens.')?.branch).toEqual([{ k: 'macro', name: 'else', args: '', of: '$faith > 2' }]);
    expect(byOriginal(entries, '<b>Blessed</b> are you.')?.branch).toEqual([{ k: 'macro', name: 'if', args: '$faith > 2' }]);
    expect(byOriginal(entries, 'You enter the chapel.')?.branch).toBeUndefined();
    expect(byOriginal(entries, 'A long & dark hall.')?.context[0]).toEqual({ k: 'ctx.tw.passageTags', p: { name: 'Hall', tags: 'room' } });
  });

  it('没有规则时自定义宏不提取', () => {
    const { entries } = extractEntries('index.html', STORY, 'TWINE');
    expect(entries.some((e) => e.original.includes('help'))).toBe(false);
  });

  it('未翻译时逐字节一致', () => {
    const out = applyTranslations('index.html', STORY, 'TWINE', new Map(), CONFIG);
    expect(out.applied).toBe(0);
    expect(dec.decode(out.data)).toBe(dec.decode(STORY));
  });

  it('写回译文：转义、链接目标与宏结构保持不变', () => {
    const { entries } = extractEntries('index.html', STORY, 'TWINE', CONFIG);
    const key = (o: string) => byOriginal(entries, o)!.key;
    const tr = new Map([
      [key('You enter the chapel.'), '你走进礼拜堂。<"&">'],
      [key('Go to the hall'), '去大厅'],
      [key('Library'), '图书馆'],
      [key('Walk to the [[garden|Garden]] or stay.'), '走到[[花园|Garden]]或者留下。'],
      [key('Pray quietly'), '静静 "祈祷"'],
      [key('I\'d like to "help" you.'), '我想"帮"你\\。'],
      [key('Welcome back'), '欢迎 "回来"'],
    ]);
    const out = applyTranslations('index.html', STORY, 'TWINE', tr, CONFIG);
    expect(out.applied).toBe(tr.size);
    const html = dec.decode(out.data);
    expect(html).toContain('你走进礼拜堂。&lt;&quot;&amp;&quot;&gt;');
    expect(html).toContain('[[去大厅|Hall]]');
    expect(html).toContain('[[图书馆|Library]]');
    expect(html).toContain('&lt;&lt;link &quot;静静 \\&quot;祈祷\\&quot;&quot; &quot;Chapel&quot;&gt;&gt;');
    // Story JavaScript 不做 HTML 转义
    expect(html).toContain('setup.greeting = "欢迎 \\"回来\\"";');

    const again = extractEntries('index.html', out.data, 'TWINE', CONFIG).entries;
    expect(again.map((e) => e.key)).toEqual(entries.map((e) => e.key));
    for (const [k, v] of tr) {
      const e = again.find((x) => x.key === k)!;
      if (e.category === 'script') continue; // 脚本字符串以源码形式显示（含转义）
      expect(e.original, k).toBe(k === key('Library') ? '图书馆' : v);
    }
    // 其余段落未受影响
    expect(html).toContain('A long &amp; dark hall.');
    expect(html).toContain('<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css">body{color:red}</style>');
  });

  it('不是故事文件、其他故事格式与 Twine 1', () => {
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as UnsupportedFileError).code;
      }
      return null;
    };
    expect(code(() => extractEntries('credits.html', enc.encode('<html><body>hi</body></html>'), 'TWINE'))).toBe('TWINE_NOT_STORY');
    expect(code(() => extractEntries('a.html', storyHtml([{ name: 'S', text: 'x' }], '', 'Harlowe'), 'TWINE'))).toBe('TWINE_FORMAT_UNSUPPORTED');
    expect(code(() => extractEntries('a.html', enc.encode('<div id="storeArea"><div tiddler="Start">x</div></div>'), 'TWINE'))).toBe('TWINE_TWINE1');
    expect(code(() => extractEntries('a.json', enc.encode('{}'), 'TWINE'))).toBe('WRONG_EXTENSION');
  });
});

describe('Twee 源码', () => {
  const TWEE = enc.encode(
    [
      ':: StoryData',
      '{"ifid": "X", "format": "SugarCube", "format-version": "2.36.1"}',
      '',
      ':: Start [intro]',
      'Welcome, traveller.',
      '<<link "Begin">><<goto "Room">><</link>>',
      '',
      ':: Room {"position":"100,100"}',
      'An empty room & a chair.',
      '',
      ':: Story JS [script]',
      'setup.hint = "Look around";',
      '',
    ].join('\n'),
  );

  it('提取与写回', () => {
    const { entries } = extractEntries('src/story.twee', TWEE, 'TWINE');
    expect(entries.map((e) => [e.key, e.original])).toEqual([
      ['passages/Start/list/0', 'Welcome, traveller.'],
      ['passages/Start/list/1', 'Begin'],
      ['passages/Room/list/0', 'An empty room & a chair.'],
      ['passages/Story JS/list/0', 'Look around'],
    ]);
    expect(dec.decode(applyTranslations('src/story.twee', TWEE, 'TWINE', new Map()).data)).toBe(dec.decode(TWEE));
    const out = applyTranslations('src/story.twee', TWEE, 'TWINE', new Map([['passages/Room/list/0', '空房间 & 椅子\n:: 不是段落']]));
    const text = dec.decode(out.data);
    expect(text).toContain('空房间 & 椅子\n ::');
    // 译文中的 :: 行不会变成新段落
    const again = extractEntries('src/story.twee', out.data, 'TWINE').entries;
    expect(again.every((e) => /^passages\/(Start|Room|Story JS)\//.test(e.key))).toBe(true);
  });

  it('其他故事格式报错', () => {
    expect(() => extractEntries('a.twee', enc.encode(':: StoryData\n{"format":"Harlowe"}\n\n:: Start\nx'), 'TWINE')).toThrow(UnsupportedFileError);
  });
});

describe('自定义宏推荐', () => {
  it('推荐显示文字与说话人参数，跳过样式与路径参数', () => {
    const lines: string[] = [];
    const speakers = ['ms', 'mc', 'ab'];
    for (let i = 0; i < 12; i++) {
      lines.push(`<<say ${speakers[i % 3]} "Line number ${i}, spoken aloud." ii>>`);
      lines.push(`<<mi "images/room${i}" 35 "left noBorder">>`);
      lines.push(`<<but "Choice ${i}" Room${i} "ev:${i}00 always">>`);
    }
    const story = storyHtml([
      { name: 'Start', text: lines.join('\n') },
      { name: 'W', tags: 'widget', text: '<<widget say>><</widget>><<widget "but">><</widget>>' },
    ]);
    const stats = analyzeTwineMacros([{ path: 'index.html', bytes: story }]);
    const say = stats.find((s) => s.name === 'say')!;
    expect(say).toMatchObject({ uses: 12, defined: true, suggested: { name: 'say', args: [1], speaker: 0 } });
    expect(stats.find((s) => s.name === 'but')!.suggested).toEqual({ name: 'but', args: [0] });
    expect(stats.find((s) => s.name === 'mi')!.suggested).toBeNull();
    // 内置宏不在统计中
    expect(stats.some((s) => s.name === 'widget' || s.name === 'link')).toBe(false);
  });
});
