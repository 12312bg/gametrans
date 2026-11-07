import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config';

/** 上传文件先落盘到存储目录的 tmp/，由解析任务处理后删除 */
export const UploadInterceptor = () =>
  FilesInterceptor('files', 5000, {
    storage: diskStorage({
      destination: join(config.storageDir, 'tmp'),
      filename: (_req, _file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: config.uploadLimitMb * 1024 * 1024 },
  });

/** multer 按 latin1 解析文件名，转回 UTF-8 */
export const fixName = (name: string) => Buffer.from(name, 'latin1').toString('utf8');

/** paths 字段：与 files 一一对应的相对路径 JSON 数组 */
export function parsePaths(raw: unknown): (string | undefined)[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' && x ? x : undefined)) : [];
  } catch {
    return [];
  }
}

export const tmpKeyOf = (f: Express.Multer.File) => `tmp/${f.filename}`;
