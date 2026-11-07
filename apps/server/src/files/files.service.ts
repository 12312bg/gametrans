import { Injectable } from '@nestjs/common';
import { ActivityService } from '../common/activity.service';
import { fail } from '../common/errors';
import { emptyCounts, stageCounts } from '../common/stats';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  async list(pid: string) {
    const [files, counts] = await Promise.all([
      this.prisma.file.findMany({ where: { projectId: pid }, orderBy: { path: 'asc' } }),
      stageCounts(this.prisma, 'fileId', { projectId: pid }),
    ]);
    return files.map(({ storageKey: _k, ...f }) => ({ ...f, stats: counts.get(f.id) ?? emptyCounts() }));
  }

  async get(pid: string, fid: string) {
    const file = await this.prisma.file.findFirst({ where: { id: fid, projectId: pid } });
    if (!file) throw fail('FILE_NOT_FOUND');
    return file;
  }

  async remove(pid: string, fid: string, userId: string) {
    const file = await this.get(pid, fid);
    await this.prisma.file.delete({ where: { id: fid } });
    if (!(await this.prisma.file.count({ where: { storageKey: file.storageKey } }))) await this.storage.remove(file.storageKey);
    await this.activity.log(pid, userId, 'file.delete', { path: file.path });
  }

  /** 校验失败时清理已落盘的临时文件 */
  async discard(files: Express.Multer.File[] | undefined) {
    for (const f of files ?? []) await this.storage.remove(`tmp/${f.filename}`);
  }
}
