/** 同一处定义中英文案；TS 会检查英文的键与中文完全一致 */
export function defineMessages<K extends string>(zh: Record<K, string>, en: Record<K, string>) {
  return { zh, en };
}
