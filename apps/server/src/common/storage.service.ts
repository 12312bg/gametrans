import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { config } from '../config';

/** 本地磁盘存储；key 为相对路径，如 projects/<id>/files/<sha256> */
@Injectable()
export class StorageService {
  readonly root = config.storageDir;

  resolve(key: string): string {
    const full = normalize(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  stream(key: string) {
    return createReadStream(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  /** 同一存储目录内移动（上传的临时文件转为正式文件，不读入内存） */
  async move(from: string, to: string): Promise<void> {
    const target = this.resolve(to);
    await mkdir(dirname(target), { recursive: true });
    await rename(this.resolve(from), target);
  }

  async sha256(key: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of this.stream(key)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true, recursive: true });
  }

  tmpDir(): string {
    return join(this.root, 'tmp');
  }
}
