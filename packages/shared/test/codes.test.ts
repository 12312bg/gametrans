import { describe, expect, it } from 'vitest';
import { controlCodeSpans, extractTags, missingControlCodes, missingTags } from '../src';

describe('控制符与名字框', () => {
  it('名字框中的名字可以翻译，删掉名字框或其他控制符仍会提示', () => {
    expect(missingControlCodes('\\n<Lucy>\\n[1]～♥️', '\\n<露西>\\n[1]～♥️')).toEqual([]);
    expect(missingControlCodes('\\nc<Lucy>你好', '\\NC<露西>你好')).toEqual([]);
    expect(missingControlCodes('\\n<Lucy>\\n[1]～♥️', '露西～♥️')).toEqual(['\\n<Lucy>', '\\n[1]']);
    expect(missingControlCodes('\\C[2]a\\C[0]', '\\C[2]a')).toEqual(['\\C[0]']);
    // 字体名不是名字框，不能改
    expect(missingControlCodes('\\fn<Arial>x', '\\fn<宋体>x')).toEqual(['\\fn<Arial>']);
  });

  it('名字框只标出 \\n< 与 >', () => {
    const text = 'a\\n<Lucy>b\\C[2]';
    const parts = controlCodeSpans(text).map((r) => text.slice(r.start, r.end));
    expect(parts).toEqual(['\\n<', '>', '\\C[2]']);
  });
});

describe('插件标签', () => {
  it('提取标签名，忽略名字框与取值', () => {
    expect(extractTags('<Help Description>\nx\n</Help Description>\n<Menu Name: Travel>\\n<Lucy>')).toEqual([
      '<Help Description>',
      '</Help Description>',
      '<Menu Name>',
    ]);
  });

  it('译文改了取值不提示，丢了或翻译了标签名才提示', () => {
    expect(missingTags('<Menu Name: Travel>', '<Menu Name: 旅行>')).toEqual([]);
    expect(missingTags('<Help:薬>', '<help:药>')).toEqual([]);
    expect(missingTags('<Help Description>\nGo\n</Help Description>', '<帮助>\n出发\n</Help Description>')).toEqual(['<Help Description>']);
  });
});
