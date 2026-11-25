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
    expect(byOriginal(entries, 'You enter the chapel.')?.category).toBe('passage');
    expect(byOriginal(entries, 'Ring the bell')?.category).toBe('choice');
    // 行内的宏与变量保留在词条中
    expect(originals).toContain('Hello, <<print $name>>! You have $gold coins.');
    // 单独一行的链接只提取显示文字
    expect(byOriginal(entries, 'Go to the hall')?.category).toBe('link');
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

  it('脚本字符串默认隐藏，特殊段落归为界面文字', () => {
    const { entries } = extractEntries('index.html', STORY, 'TWINE', CONFIG);
    const title = byOriginal(entries, 'Sister Agnes');
    expect(title).toMatchObject({ category: 'script', danger: true });
    expect(byOriginal(entries, 'Saved!')).toMatchObject({ category: 'script', danger: true });
    const greeting = byOriginal(entries, 'Welcome back');
    expect(greeting).toMatchObject({ key: 'script/0', category: 'script', danger: true });
    expect(greeting?.context).toEqual([{ k: 'ctx.tw.storyScript', p: { n: 2 } }]);
    expect(byOriginal(entries, 'Day $day')?.category).toBe('ui');
    expect(byOriginal(entries, 'Journal')?.category).toBe('ui');
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

  it('宏规则未指定分类时：有说话人为对话，否则为正文；可指定为选项', () => {
    const cat = (config: ParserConfig) => byOriginal(extractEntries('index.html', STORY, 'TWINE', config).entries, 'I\'d like to "help" you.')?.category;
    expect(cat({ twine: { macros: [{ name: 'say', args: [1], speaker: 0 }] } })).toBe('dialogue');
    expect(cat({ twine: { macros: [{ name: 'say', args: [1] }] } })).toBe('passage');
    expect(cat({ twine: { macros: [{ name: 'say', args: [1], category: 'choice' }] } })).toBe('choice');
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
    expect(say).toMatchObject({ uses: 12, source: 'widget', confidence: 'low', suggested: { name: 'say', args: [1], speaker: 0 } });
    expect(stats.find((s) => s.name === 'but')!.suggested).toEqual({ name: 'but', args: [0] });
    expect(stats.find((s) => s.name === 'mi')!.suggested).toBeNull();
    // 小写开头的短语也算显示文字（如链接文字），样式参数不算
    const prey = analyzeTwineMacros([
      {
        path: 'index.html',
        bytes: storyHtml([
          {
            name: 'Prey',
            text: ['a sister of many', 'a woman waiting at a motel', 'a thief', 'a drunken lush'].map((x, i) => `<<preylink "${x}" girl${i} many>>\n<<mi "x" "center special">>`).join('\n'),
          },
        ]),
      },
    ]);
    expect(prey.find((s) => s.name === 'preylink')!.suggested).toEqual({ name: 'preylink', args: [0] });
    expect(prey.find((s) => s.name === 'mi')!.suggested).toBeNull();
    // 内置宏不在统计中
    expect(stats.some((s) => s.name === 'widget' || s.name === 'link')).toBe(false);
  });
});

describe('按宏定义判断参数用途', () => {
  const WIDGETS = [
    '<<widget "unrelated">><<if $wife==$args[0] or $harem.includes($args[0])>><<set _UNRELATED=0>><<else>><<set _UNRELATED=1>><</if>><</widget>>',
    '<<widget "linker">><<link $args[0]>><<goto $args[1]>><</link>><</widget>>',
    '<<widget "preylink">><<set _words = $args[0], _link = $args[1], 0>><<set _classes = "preylink "+$args.slice(2).join(" ")>><<linker _words _link>><</widget>>',
    '<<widget "convo">><<set _array = $args[0].split("|")>><<for _a,_line range _array>><<set _quote = _line.split("///")[0]>><<set _prose = _line.split("///")[1]>><<quo _quote>><<= _prose ? _prose : "">><</for>><</widget>>',
    '<<widget "quo">><<= "<span>" + $args[0] + "</span>">><</widget>>',
    '<<widget "goodsex">><<set _girlface = $args[1]?$args[1]:"nobody">><<set $goodsexArray.pushUnique(_girlface)>><<if $level >= $args[0]>><<= $args[2]?$args[2]:"">><<else>><<= $args[3]?$args[3]:"">><</if>><</widget>>',
    '<<widget "headline">><<set $headlines.pushUnique($args[0])>><</widget>>',
    '<<widget "happen">><<set $HAPPENED.pushUnique($args[0])>><</widget>>',
    '<<widget "girlpic">><<set _url = "images/in/" + $args[0] + ".png">><<image _url>><</widget>>',
    '<<widget "image">><</widget>>',
    '<<widget "mindread">><<if typeof $args[0] !== "undefined">><span>"_thought"</span><</if>><<set _thought = $args[0]>><</widget>>',
  ].join('\n');
  const SCRIPT = [
    "Macro.add('speech', { tags: null, handler: function () {",
    '  var id = this.args[0], name = id;',
    '  if (this.args.length > 1) name = this.args[1];',
    "  var output = '<div class=\"speech ' + id + '\">';",
    "  output += name + '<hr>' + this.payload[0].contents + '</div>';",
    '  $(this.output).wiki(output);',
    '} });',
  ].join('\n');
  const uses = [
    '<<unrelated "Joy Smith">><<unrelated "Jean (motel)">><<unrelated "Val (blonde drunk)">>',
    '<<preylink "a sister of many" multiGirl many>><<preylink "a thief" thiefGirl>><<preylink "a drunken lush" drunkGirl>>',
    '<<convo "Hello there.///She smiles.|How are you today?">><<convo "Goodnight daddy.|Sleep well, sweetie.">>',
    '<<goodsex 10 "Faith Smith" "You did it well." "It did not go well.">><<goodsex 12 "Joy Smith" "She is happy." "She is upset.">>',
    '<<headline "A strange man was seen downtown.">><<headline "Police are baffled by the case.">>',
    '<<happen "Cinema caught">><<happen "Park visited">><<happen "Bar fight">>',
    '<<girlpic "Sherry Kuchen">><<girlpic "Joy Smith">>',
    '<<mindread "Somehow, you hear a faint voice.">><<mindread "This is kinda fun, isn\'t it?">>',
    '<<speech "Violet">>Hello!<</speech>><<speech "You" "Mark">>Hi.<</speech>><<speech "Violet">>Yes.<</speech>>',
    '<<if $HAPPENED.includes("Cinema caught")>>Seen.<</if>> <<for _h range $headlines>>_h<</for>>',
  ].join('\n');
  const story = storyHtml(
    [
      { name: 'Start', text: uses },
      { name: 'W', tags: 'widget', text: WIDGETS },
    ],
    SCRIPT,
  );
  const stats = analyzeTwineMacros([{ path: 'index.html', bytes: story }]);
  const arg = (name: string, i: number) => stats.find((s) => s.name === name)!.args.find((a) => a.i === i)!;

  it('参与比较或作为键的参数是逻辑值，不推荐翻译', () => {
    expect(arg('unrelated', 0)).toMatchObject({ verdict: 'logic', recommend: false });
    expect(arg('unrelated', 0).evidence.map((e) => e.kind)).toEqual(expect.arrayContaining(['compare', 'key']));
    expect(stats.find((s) => s.name === 'unrelated')!.suggested).toBeNull();
    // 存入变量、变量在别处按字符串查找
    expect(arg('happen', 0)).toMatchObject({ verdict: 'logic', recommend: false });
    expect(arg('happen', 0).evidence[0].kind).toBe('storedKey');
    // 拼接成图片路径
    expect(arg('girlpic', 0).verdict).toBe('logic');
    expect(arg('girlpic', 0).evidence[0].kind).toBe('path');
  });

  it('经由别名与其他宏传递：链接文字为显示，链接目标为逻辑值', () => {
    expect(arg('preylink', 0)).toMatchObject({ verdict: 'display', recommend: true });
    expect(arg('preylink', 0).evidence).toContainEqual(expect.objectContaining({ kind: 'call', via: 'linker' }));
    const s = stats.find((x) => x.name === 'preylink')!;
    expect(s).toMatchObject({ source: 'widget', confidence: 'high', suggested: { name: 'preylink', args: [0] } });
  });

  it('按 split() 识别分隔符；输出的参数是显示，与键混用时只推荐显示的', () => {
    expect(arg('convo', 0)).toMatchObject({ verdict: 'display', split: ['///', '|'] });
    expect(stats.find((x) => x.name === 'convo')!.suggested).toEqual({ name: 'convo', args: [0], split: ['///', '|'] });
    // 存入变量、别处没有输出：多半是键，不推荐
    expect(arg('goodsex', 1)).toMatchObject({ verdict: 'stored', recommend: false });
    expect(stats.find((x) => x.name === 'goodsex')!.suggested).toEqual({ name: 'goodsex', args: [2, 3] });
    // 存入变量、变量在别处被输出
    expect(arg('headline', 0)).toMatchObject({ verdict: 'display', recommend: true });
    // typeof … !== "undefined" 是存在检查，不算比较
    expect(arg('mindread', 0)).toMatchObject({ verdict: 'display', recommend: true });
  });

  it('Macro.add 定义的宏：拼进 class 为逻辑值，拼进输出为显示', () => {
    expect(arg('speech', 0).verdict).toBe('logic');
    expect(arg('speech', 0).evidence[0]).toMatchObject({ kind: 'markup' });
    expect(arg('speech', 1).verdict).toBe('display');
    expect(stats.find((x) => x.name === 'speech')!.source).toBe('script');
  });

  it('按分隔符拆成多条词条，写回时用原分隔符拼接', () => {
    const config = { twine: { macros: [{ name: 'convo', args: [0], split: ['///', '|'] }] } };
    const { entries } = extractEntries('index.html', story, 'TWINE', config);
    const convo = entries.filter((e) => (e.context[1]?.p as { macro?: string } | undefined)?.macro === 'convo');
    expect(convo.map((e) => e.original)).toEqual(['Hello there.', 'She smiles.', 'How are you today?', 'Goodnight daddy.', 'Sleep well, sweetie.']);
    const tr = new Map([
      [convo[0].key, '你好。'],
      [convo[2].key, '今天"好吗"？'],
    ]);
    const html = dec.decode(applyTranslations('index.html', story, 'TWINE', tr, config).data);
    expect(html).toContain(esc('<<convo "你好。///She smiles.|今天\\"好吗\\"？">>'));
  });
});

describe('与内置宏同名的自定义宏、整体转发参数、共享临时变量', () => {
  // 与真实游戏相同的结构：<<do "文字" 选项…>> → <<think $args "do">> → 按 _verb 调用 <<do_it>> / <<say_it>>，二者读取临时变量
  const WIDGETS = [
    '<<widget do>><<think $args "do">><</widget>>',
    '<<widget say>><<think $args "say">><</widget>>',
    '<<widget think>><<set _in = $args[0]>><<set _verb = $args[1]>><<set _txtPass = _in[0].sayOne()>>' +
      '<<for _a = 1; _a < _in.length; _a++>><<set _statement = _in[_a].toString()>><<if _statement.includes(":")>><<set _target = _statement.split(":")[1]>><</if>><</for>>' +
      '<<set _history = passage() + "__" + _txtPass>><<if $RECORDS.includes(_history)>><</if>>' +
      '<<if _verb == "say">><<say_it>><<else>><<do_it>><</if>><</widget>>',
    '<<widget do_it>><<set _txtFinal = _txtPass>><<if _txtFail != _txtPass>><</if>><<link _txtFinal>><<goto _target>><</link>><</widget>>',
    '<<widget say_it>><<set _txtFinal = _txtPass>><span>_txtFinal</span><</widget>>',
  ].join('\n');
  const SCRIPT = 'String.prototype.sayOne = function () { var arr = this.split("|"); return arr[0]; };';
  const uses = [
    '<<do "Hello, I\'m $fakeName. I\'ll be your babysitter for this evening." goto:multiGirl2 isquote>>',
    '<<do "Try talking to her." goto:talk>>',
    '<<do "Wait until an opportune time.|Wait a little longer." goto:wait hypno>3>>',
    '<<say "Nice to meet you.">><<say "Goodnight.">><<say "See you tomorrow.">>',
  ].join('\n');
  const story = storyHtml(
    [
      { name: 'Start', text: uses },
      { name: 'W', tags: 'widget', text: WIDGETS },
    ],
    SCRIPT,
  );
  const stats = analyzeTwineMacros([{ path: 'index.html', bytes: story }]);
  const macro = (name: string) => stats.find((s) => s.name === name)!;

  it('<<do>> 与内置宏同名，但作者有定义，照样分析', () => {
    expect(macro('do')).toMatchObject({ source: 'widget', confidence: 'high', suggested: { name: 'do', args: [0], category: 'choice', split: ['|'] } });
    expect(macro('do').args[0]).toMatchObject({ verdict: 'display', recommend: true });
    expect(macro('do').args[0].evidence[0]).toMatchObject({ kind: 'call', via: 'think' });
    // goto:xxx 这类选项不推荐
    expect(macro('do').args.find((a) => a.i === 1)?.recommend).toBe(false);
  });

  it('按调用方传入的常量只跟踪会执行的分支：<<say>> 走 <<say_it>>，不是链接', () => {
    expect(macro('say').suggested).toEqual({ name: 'say', args: [0], split: ['|'] });
  });

  it('按规则提取并写回', () => {
    const config: ParserConfig = { twine: { macros: [macro('do').suggested!] } };
    const { entries } = extractEntries('index.html', story, 'TWINE', config);
    const hello = byOriginal(entries, "Hello, I'm $fakeName. I'll be your babysitter for this evening.");
    expect(hello).toMatchObject({ category: 'choice' });
    expect(entries.filter((e) => e.category === 'choice').map((e) => e.original)).toEqual(
      expect.arrayContaining(['Try talking to her.', 'Wait until an opportune time.', 'Wait a little longer.']),
    );
    const html = dec.decode(applyTranslations('index.html', story, 'TWINE', new Map([[hello!.key, '你好，我是 $fakeName，今晚由我来照看孩子。']]), config).data);
    expect(html).toContain(esc('<<do "你好，我是 $fakeName，今晚由我来照看孩子。" goto:multiGirl2 isquote>>'));
  });
});

describe('带前缀的选项文字', () => {
  const WIDGETS = '<<widget "act">><<set _txt = _args[0]>><<link _txt>><</link>><</widget>>';
  const uses = [
    '<<act "Knock on the door." "response:Who is it?|It\'s me." goto:door>>',
    '<<act "Leave quietly." "response:You walk away into the night." "set:REPLY:Fine, go then!" goto:street>>',
    '<<act "Ask about the key." "set:REPLY:I lost it yesterday." "set:CHOICE3:MISC" "push:met:Abbot Joseph">>',
    '<<act "Wave." "push:met:Sister Agnes">>',
    '<<if $met.includes("Abbot Joseph")>>Known.<</if>> <<print $REPLY>>',
  ].join('\n');
  const story = storyHtml([
    { name: 'Start', text: uses },
    { name: 'W', tags: 'widget', text: WIDGETS },
  ]);
  const act = analyzeTwineMacros([{ path: 'index.html', bytes: story }]).find((s) => s.name === 'act')!;

  it('推荐前缀之后是句子的前缀；set:/push: 的变量在别处按字符串查找时不推荐', () => {
    const rec = (p: string) => act.prefixes.find((x) => x.prefix === p)?.recommend;
    expect(rec('response:')).toBe(true);
    expect(rec('set:REPLY:')).toBe(true);
    expect(rec('push:met:')).toBe(false);
    expect(act.prefixes.some((x) => x.prefix === 'set:CHOICE3:')).toBe(false); // MISC 不像句子
    expect(act.suggested).toMatchObject({ name: 'act', args: [0], prefixes: ['response:', 'set:REPLY:'] });
  });

  it('提取前缀之后的文字（按分隔符拆分），写回时保留前缀', () => {
    const config: ParserConfig = { twine: { macros: [{ name: 'act', args: [0], split: ['|'], prefixes: ['response:', 'set:REPLY:'] }] } };
    const { entries } = extractEntries('index.html', story, 'TWINE', config);
    const pre = entries.filter((e) => e.context[1]?.k === 'ctx.tw.prefixed');
    expect(pre.map((e) => e.original)).toEqual(["Who is it?", "It's me.", 'You walk away into the night.', 'Fine, go then!', 'I lost it yesterday.']);
    expect(pre[0]).toMatchObject({ category: 'dialogue', context: [expect.anything(), { k: 'ctx.tw.prefixed', p: { macro: 'act', i: 1, prefix: 'response:', n: 1 } }] });
    const tr = new Map([
      [pre[1].key, '是我。'],
      [pre[3].key, '好吧，"走吧"！'],
    ]);
    const html = dec.decode(applyTranslations('index.html', story, 'TWINE', tr, config).data);
    expect(html).toContain(esc('"response:Who is it?|是我。"'));
    expect(html).toContain(esc('"set:REPLY:好吧，\\"走吧\\"！"'));
    // 其余参数不变
    expect(html).toContain(esc('"push:met:Abbot Joseph"'));
  });
});

