import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { once } from 'node:events';
import { WriteStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 流式写 zip 到磁盘：数据文件压缩，附件原样存储并按块读取，避免整包占用内存 */
export class ZipFileWriter {
  private readonly zip: Zip;
  private readonly done: Promise<void>;
  private out!: WriteStream;
  size = 0;

  private constructor() {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    this.done = new Promise((res, rej) => ((resolve = res), (reject = rej)));
    this.zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      this.size += chunk.length;
      this.out.write(chunk);
      if (final) this.out.end(() => resolve());
    });
  }

  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true });
    const w = new ZipFileWriter();
    w.out = createWriteStream(path);
    return w;
  }

  addBytes(name: string, data: Uint8Array) {
    const f = new ZipDeflate(name, { level: 6 });
    this.zip.add(f);
    f.push(data, true);
  }

  async addStream(name: string, stream: AsyncIterable<Buffer>) {
    const f = new ZipPassThrough(name);
    this.zip.add(f);
    for await (const chunk of stream) {
      f.push(chunk);
      if (this.out.writableNeedDrain) await once(this.out, 'drain');
    }
    f.push(new Uint8Array(0), true);
  }

  async finish(): Promise<number> {
    this.zip.end();
    await this.done;
    return this.size;
  }
}
