import type { Engine, EntryCategory } from '@gametrans/shared';

/** 从文件中提取出的一条可翻译文本 */
export interface ExtractedEntry {
  /** 文件内唯一且尽量稳定的键，例如 events/1/pages/0/list/3 */
  key: string;
  original: string;
  /** 给译者看的位置说明 */
  context: string;
  category: EntryCategory;
  /** 危险文本（脚本 / 插件 / 备注），默认隐藏 */
  danger: boolean;
}

/**
 * 文本槽：提取与回写共用同一次遍历。
 * get() 读取原文；set() 把译文写回内存中的数据结构。
 */
export interface Slot extends ExtractedEntry {
  set(value: string): void;
}

export type FileFormat = 'mvmz-json' | 'mvmz-plugins' | 'rgss-marshal';

export interface ParsedDocument {
  format: FileFormat;
  /** 文件类型，如 map / actors / system / scripts / plugins */
  kind: string;
  slots: Slot[];
  warnings: string[];
  /** 把（已写入译文的）数据重新序列化 */
  serialize(): Uint8Array;
}

export interface ParseOptions {
  engine: Engine;
  /** 文件路径（用于识别文件类型），如 data/Map001.json */
  path: string;
}

export class UnsupportedFileError extends Error {}
