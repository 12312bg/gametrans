import type { ContextPart, EntryCategory, Engine, Issue, Params } from '@gametrans/shared';

export interface ExtractedEntry {
  /** 文件内唯一且尽量稳定的键，如 events/1/pages/0/list/3 */
  key: string;
  original: string;
  /** 结构化的位置说明，按查看者语言渲染 */
  context: ContextPart[];
  category: EntryCategory;
  /** 危险文本（脚本 / 插件 / 备注），默认隐藏 */
  danger: boolean;
}

/** 提取与回写共用一次遍历：set() 把译文写回内存中的数据 */
export interface Slot extends ExtractedEntry {
  set(value: string): void;
}

export type FileFormat = 'mvmz-json' | 'mvmz-plugins' | 'rgss-marshal';

export interface ParsedDocument {
  format: FileFormat;
  kind: string;
  slots: Slot[];
  warnings: Issue[];
  serialize(): Uint8Array;
}

export interface ParseOptions {
  engine: Engine;
  path: string;
}

/** 文件无法解析；code 对应 i18n 的 issue.<code> */
export class UnsupportedFileError extends Error {
  constructor(
    public readonly code: string,
    public readonly params?: Params,
  ) {
    super(code);
  }
}
