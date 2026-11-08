/** Windows 文件名不允许的字符；游戏多在 Windows 上运行 */
const INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/;
export const MAX_ATTACHMENT_PATH = 255;

/** 规范化附件路径（\ 转 /，去掉首尾 /）；不合法时返回 null */
export function normalizeAttachmentPath(raw: string): string | null {
  const segs = raw.replace(/\\/g, '/').split('/').map((s) => s.trim());
  while (segs[0] === '') segs.shift();
  while (segs.length && segs[segs.length - 1] === '') segs.pop();
  if (!segs.length) return null;
  if (segs.some((s) => s === '' || s === '.' || s === '..' || INVALID_CHARS.test(s) || /[. ]$/.test(s))) return null;
  const path = segs.join('/');
  return path.length <= MAX_ATTACHMENT_PATH ? path : null;
}

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join('/');

/** 路径的全部上级目录，如 a/b/c.txt → [a, a/b] */
export function parentDirs(path: string): string[] {
  const segs = path.split('/');
  return segs.slice(1).map((_, i) => segs.slice(0, i + 1).join('/'));
}

/**
 * 附件路径冲突检查，不区分大小写。
 * locked：与数据文件或其所在目录同名，或把数据文件当成了目录（数据文件的路径已锁定）；
 * conflict：与其他附件或附件所在目录同名。
 */
export function attachmentConflict(path: string, dataFiles: string[], otherAttachments: string[]): 'locked' | 'conflict' | null {
  const lower = path.toLowerCase();
  const parents = parentDirs(lower);
  const data = new Set(dataFiles.map((p) => p.toLowerCase()));
  const dataDirs = new Set([...data].flatMap(parentDirs));
  if (data.has(lower) || dataDirs.has(lower) || parents.some((d) => data.has(d))) return 'locked';
  const others = new Set(otherAttachments.map((p) => p.toLowerCase()).filter((p) => p !== lower));
  const otherDirs = new Set([...others].flatMap(parentDirs));
  if (otherDirs.has(lower) || parents.some((d) => others.has(d))) return 'conflict';
  return null;
}
