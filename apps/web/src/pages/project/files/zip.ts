import { inflateSync } from 'fflate';
import { Engine, normalizeGamePath } from '@gametrans/shared';

/**
 * 浏览器端读取 zip：只读中央目录和数据文件条目（File.slice 随机读取），
 * 图片、音频等大文件不会被读入内存，也不会被上传。
 */

export class ZipError extends Error {
  constructor(public code: 'ZIP_INVALID' | 'ZIP_UNSUPPORTED') {
    super(code);
  }
}

export interface PickedFile {
  file: File;
  path: string;
}

interface CdEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50, end64: 0x06064b50, end64Locator: 0x07064b50 };
const MAX32 = 0xffffffff;

async function read(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer());
}

const u8 = (v: DataView, at: number, len: number) => new Uint8Array(v.buffer, v.byteOffset + at, len);
const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** 未设置 UTF-8 标志时，常见的是 Windows 日文 / 中文系统打的包 */
function decodeName(bytes: Uint8Array, flags: number): string {
  const tries = flags & 0x800 ? ['utf-8'] : ['utf-8', 'shift_jis', 'gbk'];
  for (const enc of tries) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(bytes);
    } catch {
      /* 尝试下一种编码 */
    }
  }
  return new TextDecoder('latin1').decode(bytes);
}

async function readCentralDirectory(file: File): Promise<CdEntry[]> {
  const tailStart = Math.max(0, file.size - (22 + 0xffff + 20));
  const tail = await read(file, tailStart, file.size);
  let p = tail.byteLength - 22;
  while (p >= 0 && tail.getUint32(p, true) !== SIG.end) p--;
  if (p < 0) throw new ZipError('ZIP_INVALID');

  let count = tail.getUint16(p + 10, true);
  let size = tail.getUint32(p + 12, true);
  let offset = tail.getUint32(p + 16, true);
  if (count === 0xffff || size === MAX32 || offset === MAX32) {
    const loc = p - 20;
    if (loc < 0 || tail.getUint32(loc, true) !== SIG.end64Locator) throw new ZipError('ZIP_INVALID');
    const at = u64(tail, loc + 8);
    const end64 = await read(file, at, at + 56);
    if (end64.getUint32(0, true) !== SIG.end64) throw new ZipError('ZIP_INVALID');
    count = u64(end64, 32);
    size = u64(end64, 40);
    offset = u64(end64, 48);
  }
  if (offset + size > file.size) throw new ZipError('ZIP_INVALID');

  const cd = await read(file, offset, offset + size);
  const entries: CdEntry[] = [];
  let q = 0;
  for (let i = 0; i < count; i++) {
    if (q + 46 > cd.byteLength || cd.getUint32(q, true) !== SIG.central) throw new ZipError('ZIP_INVALID');
    const flags = cd.getUint16(q + 8, true);
    const nameLen = cd.getUint16(q + 28, true);
    const extraLen = cd.getUint16(q + 30, true);
    const commentLen = cd.getUint16(q + 32, true);
    const e: CdEntry = {
      name: decodeName(u8(cd, q + 46, nameLen), flags),
      flags,
      method: cd.getUint16(q + 10, true),
      compressedSize: cd.getUint32(q + 20, true),
      size: cd.getUint32(q + 24, true),
      offset: cd.getUint32(q + 42, true),
    };
    // ZIP64 扩展字段：只包含值为 0xFFFFFFFF 的那几项，顺序固定
    for (let x = q + 46 + nameLen, end = x + extraLen; x + 4 <= end; x += 4 + cd.getUint16(x + 2, true)) {
      if (cd.getUint16(x, true) !== 0x0001) continue;
      let f = x + 4;
      for (const k of ['size', 'compressedSize', 'offset'] as const) {
        if (e[k] === MAX32) {
          e[k] = u64(cd, f);
          f += 8;
        }
      }
    }
    entries.push(e);
    q += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractEntry(file: File, e: CdEntry): Promise<Uint8Array> {
  if (e.flags & 1 || (e.method !== 0 && e.method !== 8)) throw new ZipError('ZIP_UNSUPPORTED');
  const head = await read(file, e.offset, e.offset + 30);
  if (head.getUint32(0, true) !== SIG.local) throw new ZipError('ZIP_INVALID');
  const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
  const raw = new Uint8Array(await file.slice(start, start + e.compressedSize).arrayBuffer());
  return e.method === 0 ? raw : inflateSync(raw, { out: new Uint8Array(e.size) });
}

export interface ZipExtraction {
  files: PickedFile[];
  /** 非数据文件（图片、音频等）数量 */
  skipped: number;
}

export async function extractGameZip(zip: File, engine: Engine, onProgress?: (pct: number) => void): Promise<ZipExtraction> {
  const entries = (await readCentralDirectory(zip)).filter((e) => !e.name.endsWith('/'));
  const wanted = entries.flatMap((e) => {
    const path = normalizeGamePath(e.name, engine);
    return path ? [{ e, path }] : [];
  });
  const total = wanted.reduce((n, w) => n + w.e.compressedSize, 0) || 1;
  const files: PickedFile[] = [];
  let done = 0;
  for (const { e, path } of wanted) {
    const data = await extractEntry(zip, e);
    files.push({ file: new File([data as BlobPart], path.split('/').pop()!), path });
    done += e.compressedSize;
    onProgress?.(Math.round((done / total) * 100));
    // 让出主线程，保持界面响应
    await new Promise((r) => setTimeout(r));
  }
  return { files, skipped: entries.length - wanted.length };
}
