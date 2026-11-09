/** 选中的本地文件：path 为相对所选文件夹的路径（含文件夹名），如 img/pictures/a.rpgmvp */
export interface PickedFile {
  path: string;
  file: File;
}

export const filesFromInput = (list: FileList | File[]): PickedFile[] =>
  Array.from(list).map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));

/** 拖入的文件与文件夹（递归读取文件夹） */
export async function filesFromDrop(dt: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return filesFromInput(dt.files);
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ path, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries 每次最多返回一批，读到空数组为止
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, path);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export interface ImageItem {
  id: string;
  /** 源文件路径 */
  path: string;
  /** 转换后的文件名与完整路径 */
  outName: string;
  outPath: string;
  dir: string;
  file: File;
}

export interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
  images: ImageItem[];
  /** 含子目录的图片总数 */
  total: number;
}

export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export function buildTree(items: ImageItem[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [], images: [], total: 0 };
  const nodes = new Map<string, FolderNode>([['', root]]);
  const ensure = (path: string): FolderNode => {
    const hit = nodes.get(path);
    if (hit) return hit;
    const node: FolderNode = { path, name: path.slice(path.lastIndexOf('/') + 1), children: [], images: [], total: 0 };
    nodes.set(path, node);
    ensure(dirOf(path)).children.push(node);
    return node;
  };
  for (const item of items) ensure(item.dir).images.push(item);
  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.images.sort((a, b) => a.outName.localeCompare(b.outName, undefined, { numeric: true }));
    n.total = n.images.length + n.children.reduce((s, c) => s + finish(c), 0);
    return n.total;
  };
  finish(root);
  return root;
}

/** 目录及其子目录中的全部图片 */
export function imagesUnder(node: FolderNode): ImageItem[] {
  return [...node.images, ...node.children.flatMap(imagesUnder)];
}

export function findFolder(root: FolderNode, path: string): FolderNode {
  if (!path) return root;
  for (const c of root.children) {
    if (c.path === path) return c;
    if (path.startsWith(`${c.path}/`)) return findFolder(c, path);
  }
  return root;
}
