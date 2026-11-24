import { describe, expect, it } from 'vitest';
import {
  checkMarkup,
  controlCodeSpans,
  escapeMacroString,
  lexSugarCube,
  normalizeGamePath,
  normalizeTwineConfig,
  parseMacroArgs,
  unescapeMacroString,
} from '../src';

const types = (s: string) => lexSugarCube(s).map((t) => [t.t, s.slice(t.start, t.end)]);

describe('SugarCube 词法', () => {
  it('切分宏、链接、变量、HTML 与格式标记', () => {
    expect(types('Hi $name.first, <<print _x>> [[Go|Hall]] <b>bold</b> //it// &amp;')).toEqual([
      ['text', 'Hi '],
      ['var', '$name.first'],
      ['text', ', '],
      ['macro', '<<print _x>>'],
      ['text', ' '],
      ['link', '[[Go|Hall]]'],
      ['text', ' '],
      ['html', '<b>'],
      ['text', 'bold'],
      ['html', '</b>'],
      ['text', ' '],
      ['format', '//'],
      ['text', 'it'],
      ['format', '//'],
      ['text', ' '],
      ['format', '&amp;'],
    ]);
  });

  it('宏参数中的 >> 与引号、脚本块、注释', () => {
    expect(types('<<say ms "a >> b" ii>>')).toEqual([['macro', '<<say ms "a >> b" ii>>']]);
    expect(types('<<script>>if (a >> 1) {}<</script>>x')).toEqual([
      ['raw', '<<script>>if (a >> 1) {}<</script>>'],
      ['text', 'x'],
    ]);
    expect(types('a/* c */b<!-- d -->')).toEqual([
      ['text', 'a'],
      ['comment', '/* c */'],
      ['text', 'b'],
      ['comment', '<!-- d -->'],
    ]);
    // 不是宏、不是变量
    expect(types('a << b, $5, snake_case, http://x')).toEqual([['text', 'a << b, $5, snake_case, http://x']]);
  });

  it('链接的四种写法', () => {
    const link = (s: string) => {
      const t = lexSugarCube(s)[0];
      if (t.t !== 'link') throw new Error('not a link');
      return [s.slice(t.link.labelStart, t.link.labelEnd), t.link.target, t.link.form];
    };
    expect(link('[[Go|Hall]]')).toEqual(['Go', 'Hall', 'pipe']);
    expect(link('[[Go->Hall]]')).toEqual(['Go', 'Hall', 'arrow']);
    expect(link('[[Hall<-Go]]')).toEqual(['Go', 'Hall', 'back']);
    expect(link('[[Hall]]')).toEqual(['Hall', 'Hall', 'simple']);
    expect(link('[[Go|Hall][$x to 1]]')).toEqual(['Go', 'Hall', 'pipe']);
  });

  it('宏参数切分与字符串转义', () => {
    const s = '<<say ms "I\\"m here" [[Go|Hall]] `1+1` 3>>';
    const tok = lexSugarCube(s)[0];
    if (tok.t !== 'macro') throw new Error('not a macro');
    expect(parseMacroArgs(s, tok.argsStart, tok.argsEnd).map((a) => a.t)).toEqual(['bare', 'string', 'link', 'expr', 'bare']);
    expect(unescapeMacroString('I\\"m \\\\ \\n')).toBe('I"m \\ \n');
    expect(escapeMacroString('I"m \\ \n', '"')).toBe('I\\"m \\\\ \\n');
  });
});

describe('Twine 标记检查', () => {
  it('高亮宏与链接外壳，显示文字可翻译', () => {
    const text = 'Go [[home|Home]] <<print $x>>';
    expect(controlCodeSpans(text, 'TWINE').map((r) => text.slice(r.start, r.end))).toEqual(['[[', '|Home]]', '<<print $x>>']);
    // RPG Maker 项目不受影响
    expect(controlCodeSpans(text, 'RMMZ')).toEqual([]);
  });

  it('漏掉宏、变量或改了链接目标时提示，改显示文字不提示', () => {
    expect(checkMarkup('Hi $name, [[go|Hall]]', '你好 $name，[[去|Hall]]', 'dialogue', 'TWINE').missingCodes).toEqual([]);
    expect(checkMarkup('Hi $name, [[go|Hall]]', '你好，[[去|大厅]]', 'dialogue', 'TWINE').missingCodes).toEqual(['$name', '[[…|Hall]]']);
    expect(checkMarkup('<<print  $x>> left', '<<print $x>> 走了', 'dialogue', 'TWINE').missingCodes).toEqual([]);
    expect(checkMarkup('a', 'b <<goto "x">>', 'dialogue', 'TWINE').extraCodes).toEqual(['<<goto "x">>']);
    // \C[2] 在 Twine 中只是文字
    expect(checkMarkup('\\C[2]a', 'a', 'dialogue', 'TWINE').missingCodes).toEqual([]);
  });
});

describe('Twine 路径与规则', () => {
  it('接受 html / twee 文件，保留相对路径', () => {
    expect(normalizeGamePath('Game/www/index.html', 'TWINE')).toBe('Game/www/index.html');
    expect(normalizeGamePath('src\\story.twee', 'TWINE')).toBe('src/story.twee');
    expect(normalizeGamePath('img/a.png', 'TWINE')).toBeNull();
    expect(normalizeGamePath('__MACOSX/index.html', 'TWINE')).toBeNull();
  });

  it('校验宏规则', () => {
    expect(normalizeTwineConfig({ macros: [{ name: 'say', args: [2, 1, 1], speaker: 0, category: 'dialogue' }] })).toEqual({
      ok: true,
      value: { macros: [{ name: 'say', args: [1, 2], speaker: 0 }] },
    });
    expect(normalizeTwineConfig({ macros: [{ name: 'but', args: 'all', category: 'choice' }] }).ok).toBe(true);
    expect(normalizeTwineConfig({ macros: [{ name: 'bad name', args: [0] }] }).ok).toBe(false);
    expect(normalizeTwineConfig({ macros: [{ name: 'a', args: [-1] }] }).ok).toBe(false);
    expect(normalizeTwineConfig({ macros: [{ name: 'a', args: [0] }, { name: 'a', args: [1] }] }).ok).toBe(false);
    expect(normalizeTwineConfig(null).ok).toBe(false);
  });
});
