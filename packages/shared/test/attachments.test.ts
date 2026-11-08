import { describe, expect, it } from 'vitest';
import { attachmentConflict, joinPath, normalizeAttachmentPath, parentDirs } from '../src';

describe('附件路径', () => {
  it('规范化', () => {
    expect(normalizeAttachmentPath('www\\img\\Quests.txt')).toBe('www/img/Quests.txt');
    expect(normalizeAttachmentPath('/www/img/')).toBe('www/img');
    expect(normalizeAttachmentPath(' a / b.txt ')).toBe('a/b.txt');
    for (const bad of ['', '/', 'a/../b', 'a//b', './a', 'a/b:c', 'a/b?', 'con.', 'x\u0001']) {
      expect(normalizeAttachmentPath(bad), bad).toBeNull();
    }
    expect(normalizeAttachmentPath('a/'.repeat(200) + 'b')).toBeNull();
  });

  it('拼接路径时忽略空的部分', () => {
    expect(joinPath('www/data', '')).toBe('www/data');
    expect(joinPath('', 'a.txt')).toBe('a.txt');
    expect(joinPath('www', 'img', 'a.txt')).toBe('www/img/a.txt');
  });

  it('上级目录', () => {
    expect(parentDirs('a/b/c.txt')).toEqual(['a', 'a/b']);
    expect(parentDirs('c.txt')).toEqual([]);
  });

  it('不能覆盖数据文件或其目录，不区分大小写', () => {
    const data = ['www/data/Map001.json', 'www/js/plugins.js'];
    expect(attachmentConflict('www/img/Quests.txt', data, [])).toBeNull();
    expect(attachmentConflict('Quests.txt', data, [])).toBeNull();
    expect(attachmentConflict('WWW/Data/map001.json', data, [])).toBe('locked');
    expect(attachmentConflict('www/data', data, [])).toBe('locked');
    expect(attachmentConflict('www/data/Map001.json/x.txt', data, [])).toBe('locked');
    expect(attachmentConflict('www/data/Quests.json', data, [])).toBeNull();
  });

  it('附件之间：同名文件与目录冲突，同一路径视为覆盖', () => {
    const atts = ['www/img/Quests.txt'];
    expect(attachmentConflict('www/img/quests.txt', [], atts)).toBeNull();
    expect(attachmentConflict('www/img', [], atts)).toBe('conflict');
    expect(attachmentConflict('www/img/Quests.txt/a.png', [], atts)).toBe('conflict');
  });
});
