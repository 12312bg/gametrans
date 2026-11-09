import { describe, expect, it } from 'vitest';
import { buildTree, findFolder, imagesUnder, type ImageItem } from '../src/pages/tools/image-crypto/collect';
import {
  PNG_HEAD,
  decryptBlob,
  decryptBytes,
  decryptedName,
  encryptBlob,
  encryptBytes,
  encryptedName,
  hasHeader,
  keyFromSystemJson,
  keyToHex,
  parseKey,
  recoverKey,
} from '../src/pages/tools/image-crypto/rpgmv';

/** 1×1 透明 PNG */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
    .split('')
    .map((c) => c.charCodeAt(0)),
);
const KEY_HEX = 'd41d8cd98f00b204e9800998ecf8427e';
const KEY = parseKey(KEY_HEX)!;

describe('RPG Maker 加密图片', () => {
  it('加密后带文件头，前 16 字节与密钥异或，其余不变', () => {
    const enc = encryptBytes(PNG, KEY);
    expect(enc.length).toBe(PNG.length + 16);
    expect(hasHeader(enc)).toBe(true);
    expect(new TextDecoder().decode(enc.slice(0, 5))).toBe('RPGMV');
    expect(Array.from(enc.slice(16, 32))).toEqual(Array.from(PNG.slice(0, 16), (b, i) => b ^ KEY[i]));
    expect(Array.from(enc.slice(32))).toEqual(Array.from(PNG.slice(16)));
  });

  it('解密不需要密钥，并能从加密文件反推密钥', () => {
    const enc = encryptBytes(PNG, KEY);
    expect(Array.from(decryptBytes(enc))).toEqual(Array.from(PNG));
    expect(keyToHex(recoverKey(enc)!)).toBe(KEY_HEX);
    expect(() => decryptBytes(PNG)).toThrow('NOT_ENCRYPTED');
  });

  it('Blob 版本与字节版本一致', async () => {
    const enc = await encryptBlob(new Blob([PNG]), KEY);
    expect(Array.from(new Uint8Array(await enc.arrayBuffer()))).toEqual(Array.from(encryptBytes(PNG, KEY)));
    const dec = await decryptBlob(enc);
    expect(dec.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await dec.arrayBuffer()))).toEqual(Array.from(PNG));
    await expect(encryptBlob(new Blob([new Uint8Array(20)]), KEY)).rejects.toThrow('NOT_PNG');
    await expect(decryptBlob(new Blob([PNG]))).rejects.toThrow('NOT_ENCRYPTED');
  });

  it('密钥解析', () => {
    expect(parseKey('xyz')).toBeNull();
    expect(parseKey(KEY_HEX.toUpperCase())).toEqual(KEY);
    expect(keyFromSystemJson(`﻿{"hasEncryptedImages":true,"encryptionKey":"${KEY_HEX}"}`)).toEqual(KEY);
    expect(keyFromSystemJson('{"encryptionKey":""}')).toBeNull();
    expect(keyFromSystemJson('not json')).toBeNull();
    expect(PNG_HEAD.length).toBe(16);
  });

  it('文件名转换', () => {
    expect(decryptedName('Actor1.rpgmvp')).toBe('Actor1.png');
    expect(decryptedName('a.b.png_')).toBe('a.b.png');
    expect(encryptedName('Actor1.png', '.rpgmvp')).toBe('Actor1.rpgmvp');
    expect(encryptedName('Actor1.png', '.png_')).toBe('Actor1.png_');
  });

  it('目录树', () => {
    const item = (path: string): ImageItem => ({ id: path, path, outName: path.split('/').pop()!, outPath: path, dir: path.slice(0, path.lastIndexOf('/')), file: new File([], 'x') });
    const root = buildTree(['img/pictures/b.png', 'img/pictures/a10.png', 'img/pictures/a2.png', 'img/faces/f.png', 'img/x.png'].map(item));
    expect(root.total).toBe(5);
    const img = findFolder(root, 'img');
    expect(img.children.map((c) => c.name)).toEqual(['faces', 'pictures']);
    expect(findFolder(root, 'img/pictures').images.map((i) => i.outName)).toEqual(['a2.png', 'a10.png', 'b.png']);
    expect(imagesUnder(img)).toHaveLength(5);
  });
});
