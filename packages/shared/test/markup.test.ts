import { describe, expect, it } from 'vitest';
import { checkMarkup, hasMissingMarkup, sourceCodeIssues } from '../src';

describe('译文控制符检查', () => {
  it('占位符可以调整顺序，缺失或多出才提示', () => {
    expect(checkMarkup('%1 gave %2 to you', '%2 是 %1 给你的').missingPlaceholders).toEqual([]);
    const r = checkMarkup('%1 gave %2', '%1 给了');
    expect(r.missingPlaceholders).toEqual(['%2']);
    expect(hasMissingMarkup(r)).toBe(true);
    expect(checkMarkup('%1', '%1 %3').extraPlaceholders).toEqual(['%3']);
  });

  it('控制符缺失与多出分别报告，不要求顺序', () => {
    const r = checkMarkup('\\C[4]Sword\\C[0] \\I[87]', '\\I[87]\\C[4]剑');
    expect(r.missingCodes).toEqual(['\\C[0]']);
    expect(r.extraCodes).toEqual([]);
    expect(checkMarkup('a', '\\C[2]a').extraCodes).toEqual(['\\C[2]']);
  });

  it('标签只检查备注 / 注释类', () => {
    expect(checkMarkup('<Help Description>x', 'y', 'comment').missingTags).toEqual(['<Help Description>']);
    expect(checkMarkup('<Help Description>x', 'y', 'dialogue').missingTags).toEqual([]);
  });

  it('译文为空时只报告原文问题', () => {
    const r = checkMarkup('\\I[87 Potion', '');
    expect(r.missingCodes).toEqual([]);
    expect(r.sourceIssues.map((i) => [i.kind, i.text])).toEqual([['unclosedBracket', '\\I[87']]);
  });
});

describe('原文控制符问题', () => {
  it('识别缺右括号、参数错误、空参数、全角、行末反斜杠', () => {
    const kinds = (s: string) => sourceCodeIssues(s).map((i) => i.kind);
    expect(kinds('\\I[87 Potion')).toEqual(['unclosedBracket']);
    expect(kinds('\\C[x]a\\V[]')).toEqual(['badArgument', 'emptyArgument']);
    expect(kinds('＼C[2]a \\I［87］')).toEqual(['fullWidth', 'fullWidth']);
    expect(kinds('line\\\nnext')).toEqual(['trailingBackslash']);
    expect(kinds('\\C[2]ok\\C[0] \\I[87] \\FS[24] \\n<Lucy>')).toEqual([]);
  });
});
