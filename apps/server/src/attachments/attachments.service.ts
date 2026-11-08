import { Injectable } from '@nestjs/common';
import { attachmentConflict, joinPath, normalizeAttachmentPath } from '@gametrans/shared';
import { ActivityService } from '../common/activity.service';
import { fail } from '../common/errors';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AttachmentUpload {
  tmpKey: string;
  size: number;
  /** 相对目标目录的路径（选择文件夹上传时含子目录） */
  name: string;
}

const SELECT = {
  id: true,
  path: true,
  size: true,
  sha256: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, username: true, displayName: true } },
} as const;

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  list(projectId: string) {
    return this.prisma.attachment.findMany({ where: { projectId }, orderBy: { path: 'asc' }, select: SELECT });
  }

  async get(projectId: string, id: string) {
    const a = await this.prisma.attachment.findFirst({ where: { id, projectId } });
    if (!a) throw fail('ATTACHMENT_NOT_FOUND');
    return a;
  }

  /** 校验路径：数据文件的路径与目录锁定；同一路径（不区分大小写）的附件被覆盖 */
  private async plan(projectId: string, dir: string, uploads: AttachmentUpload[]) {
    const base = dir.trim() ? normalizeAttachmentPath(dir) : '';
    if (base === null) throw fail('ATTACHMENT_PATH_INVALID', { path: dir });
    const [files, existing] = await Promise.all([
      this.prisma.file.findMany({ where: { projectId }, select: { path: true } }),
      this.prisma.attachment.findMany({ where: { projectId }, select: { id: true, path: true, storageKey: true } }),
    ]);
    const byLower = new Map(existing.map((a) => [a.path.toLowerCase(), a]));
    const paths = uploads.map((u) => {
      const rel = normalizeAttachmentPath(u.name);
      const path = rel === null ? null : normalizeAttachmentPath(joinPath(base, rel));
      if (path === null) throw fail('ATTACHMENT_PATH_INVALID', { path: joinPath(base, u.name) });
      return path;
    });
    const dataPaths = files.map((f) => f.path);
    const all = [...existing.map((a) => a.path), ...paths];
    const seen = new Set<string>();
    for (const path of paths) {
      const lower = path.toLowerCase();
      if (seen.has(lower)) throw fail('ATTACHMENT_PATH_CONFLICT', { path });
      seen.add(lower);
      const hit = attachmentConflict(path, dataPaths, all);
      if (hit) throw fail(hit === 'locked' ? 'ATTACHMENT_PATH_LOCKED' : 'ATTACHMENT_PATH_CONFLICT', { path });
    }
    return paths.map((path, i) => ({ path, upload: uploads[i], existing: byLower.get(path.toLowerCase()) }));
  }

  async upload(projectId: string, userId: string, dir: string, uploads: AttachmentUpload[]) {
    let planned: Awaited<ReturnType<AttachmentsService['plan']>>;
    try {
      planned = await this.plan(projectId, dir, uploads);
    } catch (e) {
      for (const u of uploads) await this.storage.remove(u.tmpKey);
      throw e;
    }
    let created = 0;
    for (const { path, upload, existing } of planned) {
      const sha256 = await this.storage.sha256(upload.tmpKey);
      const storageKey = `projects/${projectId}/attachments/${sha256}`;
      if (await this.storage.exists(storageKey)) await this.storage.remove(upload.tmpKey);
      else await this.storage.move(upload.tmpKey, storageKey);
      const data = { path, storageKey, size: upload.size, sha256, createdById: userId };
      if (existing) {
        await this.prisma.attachment.update({ where: { id: existing.id }, data });
        if (existing.storageKey !== storageKey) await this.removeBlobIfUnused(existing.storageKey);
      } else {
        await this.prisma.attachment.create({ data: { projectId, ...data } });
        created++;
      }
    }
    const updated = planned.length - created;
    await this.activity.log(projectId, userId, 'attachment.upload', { created, updated });
    await this.prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return { created, updated, items: await this.list(projectId) };
  }

  async remove(projectId: string, id: string, userId: string) {
    const a = await this.get(projectId, id);
    await this.prisma.attachment.delete({ where: { id: a.id } });
    await this.removeBlobIfUnused(a.storageKey);
    await this.activity.log(projectId, userId, 'attachment.delete', { path: a.path });
  }

  /** 内容相同的附件共用一份存储 */
  private async removeBlobIfUnused(storageKey: string) {
    if (!(await this.prisma.attachment.count({ where: { storageKey } }))) await this.storage.remove(storageKey);
  }
}
