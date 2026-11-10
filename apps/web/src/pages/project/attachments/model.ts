import { isAudioPath, isEncryptedImagePath, isImagePath, isTextPath, parentDirs } from '@gametrans/shared';
import type { Attachment, FileItem, UserBrief } from '../../../api/types';

export type ItemKind = 'image' | 'encrypted' | 'audio' | 'text' | 'data' | 'binary';

export interface ExplorerItem {
  /** a:<附件 id> 或 f:<数据文件 id> */
  key: string;
  source: 'attachment' | 'data';
  id: string;
  path: string;
  name: string;
  dir: string;
  kind: ItemKind;
  size: number;
  edited: boolean;
  updatedAt: string;
  by: UserBrief | null;
  attachment?: Attachment;
}

export interface Folder {
  path: string;
  name: string;
  /** 含数据文件的目录：路径锁定 */
  locked: boolean;
  children: Folder[];
  items: ExplorerItem[];
  total: number;
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function kindOf(path: string, source: ExplorerItem['source']): ItemKind {
  if (source === 'data') return /\.(json|js)$/i.test(path) ? 'data' : 'binary';
  if (isEncryptedImagePath(path)) return 'encrypted';
  if (isImagePath(path)) return 'image';
  if (isAudioPath(path)) return 'audio';
  if (isTextPath(path)) return 'text';
  return 'binary';
}

export function toItems(attachments: Attachment[], files: FileItem[], showData: boolean): ExplorerItem[] {
  const atts = attachments.map<ExplorerItem>((a) => ({
    key: `a:${a.id}`,
    source: 'attachment',
    id: a.id,
    path: a.path,
    name: nameOf(a.path),
    dir: dirOf(a.path),
    kind: kindOf(a.path, 'attachment'),
    size: a.editSize ?? a.size,
    edited: !!a.editedAt,
    updatedAt: a.editedAt ?? a.updatedAt,
    by: a.editedBy ?? a.createdBy,
    attachment: a,
  }));
  if (!showData) return atts;
  const data = files.map<ExplorerItem>((f) => ({
    key: `f:${f.id}`,
    source: 'data',
    id: f.id,
    path: f.path,
    name: nameOf(f.path),
    dir: dirOf(f.path),
    kind: kindOf(f.path, 'data'),
    size: f.size,
    edited: !!f.edited,
    updatedAt: f.editedAt ?? f.updatedAt,
    by: null,
  }));
  return [...data, ...atts];
}

/** 目录树；数据文件所在的目录始终标为锁定 */
export function buildFolders(items: ExplorerItem[], dataPaths: string[]): Folder {
  const lockedDirs = new Set(dataPaths.flatMap(parentDirs));
  const root: Folder = { path: '', name: '', locked: false, children: [], items: [], total: 0 };
  const nodes = new Map<string, Folder>([['', root]]);
  const ensure = (path: string): Folder => {
    const hit = nodes.get(path);
    if (hit) return hit;
    const node: Folder = { path, name: nameOf(path), locked: lockedDirs.has(path), children: [], items: [], total: 0 };
    nodes.set(path, node);
    ensure(dirOf(path)).children.push(node);
    return node;
  };
  for (const item of items) ensure(item.dir).items.push(item);
  const finish = (f: Folder): number => {
    f.children.sort((a, b) => a.name.localeCompare(b.name));
    f.items.sort((a, b) => Number(a.source === 'attachment') - Number(b.source === 'attachment') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    f.total = f.items.length + f.children.reduce((n, c) => n + finish(c), 0);
    return f.total;
  };
  finish(root);
  return root;
}

export function findFolder(root: Folder, path: string): Folder {
  if (!path) return root;
  for (const c of root.children) {
    if (c.path === path) return c;
    if (path.startsWith(`${c.path}/`)) return findFolder(c, path);
  }
  return root;
}

export const itemsUnder = (f: Folder): ExplorerItem[] => [...f.items, ...f.children.flatMap(itemsUnder)];

export const contentUrl = (pid: string, item: ExplorerItem, version?: 'original' | 'edited') =>
  item.source === 'attachment'
    ? `/projects/${pid}/attachments/${item.id}/download${version ? `?version=${version}` : ''}`
    : `/projects/${pid}/files/${item.id}/download${version === 'edited' ? '?version=edited' : ''}`;
