import type { ImageItem } from './collect';
import { decryptBlob, encryptBlob } from './rpgmv';

export type Mode = 'decrypt' | 'encrypt';

/** 按需转换并缓存结果；模式或密钥变化时整体替换 */
export class Converter {
  private readonly outputs = new Map<string, Promise<Blob>>();
  private readonly urls = new Map<string, Promise<string>>();
  private readonly created: string[] = [];

  constructor(
    readonly mode: Mode,
    private readonly key: Uint8Array | null,
  ) {}

  /** 转换后的文件（下载用） */
  output(item: ImageItem): Promise<Blob> {
    let p = this.outputs.get(item.id);
    if (!p) {
      p = this.mode === 'decrypt' ? decryptBlob(item.file) : this.key ? encryptBlob(item.file, this.key) : Promise.reject(new Error('NO_KEY'));
      this.outputs.set(item.id, p);
    }
    return p;
  }

  /** 用于显示的图片地址：解密模式显示解密结果，加密模式显示原图 */
  url(item: ImageItem): Promise<string> {
    let p = this.urls.get(item.id);
    if (!p) {
      const blob = this.mode === 'decrypt' ? this.output(item) : Promise.resolve(item.file);
      p = blob.then((b) => {
        const u = URL.createObjectURL(b);
        this.created.push(u);
        return u;
      });
      this.urls.set(item.id, p);
    }
    return p;
  }

  dispose() {
    for (const u of this.created.splice(0)) URL.revokeObjectURL(u);
  }
}
