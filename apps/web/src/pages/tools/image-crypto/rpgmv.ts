/**
 * RPG Maker MV / MZ 的加密资源格式：
 * 16 字节文件头（"RPGMV" + 版本） + 原文件前 16 字节与密钥逐字节异或 + 原文件其余部分。
 * MV 图片扩展名为 .rpgmvp，MZ 为 .png_，格式相同。
 */

export const HEADER = Uint8Array.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0, 0, 0, 0, 3, 1, 0, 0, 0, 0, 0]);
/** PNG 文件固定的前 16 字节：签名 + IHDR 块头，因此解密图片不需要密钥 */
export const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);

export const ENCRYPTED_EXTS = ['.rpgmvp', '.png_'] as const;
export type EncryptedExt = (typeof ENCRYPTED_EXTS)[number];

const extOf = (name: string) => name.slice(name.lastIndexOf('.')).toLowerCase();
export const isEncryptedName = (name: string) => (ENCRYPTED_EXTS as readonly string[]).includes(extOf(name));
export const isPngName = (name: string) => extOf(name) === '.png';

/** foo.rpgmvp / foo.png_ → foo.png；foo.png → foo.rpgmvp 或 foo.png_ */
export const decryptedName = (name: string) => `${name.slice(0, name.lastIndexOf('.'))}.png`;
export const encryptedName = (name: string, ext: EncryptedExt) => `${name.slice(0, name.lastIndexOf('.'))}${ext}`;

export function hasHeader(head: Uint8Array): boolean {
  return head.length >= 32 && HEADER.slice(0, 5).every((b, i) => head[i] === b);
}

export function isPng(head: Uint8Array): boolean {
  return head.length >= 16 && PNG_HEAD.every((b, i) => head[i] === b);
}

/** 32 位十六进制字符串（System.json 的 encryptionKey） → 16 字节 */
export function parseKey(hex: string): Uint8Array | null {
  const s = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) return null;
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
}

export const keyToHex = (key: Uint8Array) => Array.from(key, (b) => b.toString(16).padStart(2, '0')).join('');

/** 从加密图片的前 32 字节反推密钥 */
export function recoverKey(head: Uint8Array): Uint8Array | null {
  if (!hasHeader(head)) return null;
  return Uint8Array.from({ length: 16 }, (_, i) => head[16 + i] ^ PNG_HEAD[i]);
}

/** 从 System.json 文本读取密钥 */
export function keyFromSystemJson(text: string): Uint8Array | null {
  try {
    const key = (JSON.parse(text.replace(/^﻿/, '')) as { encryptionKey?: unknown }).encryptionKey;
    return typeof key === 'string' ? parseKey(key) : null;
  } catch {
    return null;
  }
}

export function decryptBytes(data: Uint8Array): Uint8Array {
  if (!hasHeader(data)) throw new Error('NOT_ENCRYPTED');
  const out = data.slice(16);
  out.set(PNG_HEAD, 0);
  return out;
}

export function encryptBytes(png: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(png.length + 16);
  out.set(HEADER, 0);
  out.set(png, 16);
  for (let i = 0; i < 16 && i < png.length; i++) out[16 + i] ^= key[i];
  return out;
}

const head = async (blob: Blob, n: number) => new Uint8Array(await blob.slice(0, n).arrayBuffer());

/** 解密：只替换文件头，其余部分直接引用原文件，不复制数据 */
export async function decryptBlob(file: Blob): Promise<Blob> {
  if (!hasHeader(await head(file, 32))) throw new Error('NOT_ENCRYPTED');
  return new Blob([PNG_HEAD as BlobPart, file.slice(32)], { type: 'image/png' });
}

export async function encryptBlob(file: Blob, key: Uint8Array): Promise<Blob> {
  const first = await head(file, 16);
  if (!isPng(first)) throw new Error('NOT_PNG');
  const x = first.map((b, i) => b ^ key[i]);
  return new Blob([HEADER as BlobPart, x as BlobPart, file.slice(16)], { type: 'application/octet-stream' });
}

export async function keyFromEncryptedFile(file: Blob): Promise<Uint8Array | null> {
  return recoverKey(await head(file, 32));
}
