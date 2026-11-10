import { Injectable } from '@nestjs/common';
import { PREEDIT_MAX_BYTES, attachmentConflict, isTextPath, joinPath, normalizeAttachmentPath } from '@gametrans/shared';
import { createHash } from 'node:crypto';
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

const USER = { select: { id: true, username: true, displayName: true } } as const;
const SELECT = {
  id: true,
  path: true,
  size: true,
  sha256: true,
  createdAt: true,
  updatedAt: true,
  editSize: true,
  editedAt: true,
  createdBy: USER,
  editedBy: USER,
} as const;

// ignoreBOM：保留 BOM，便于写回时原样保留
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

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

  /** 校验路径：数据文件的路径与目录锁定；同一路径（不区分大小写）的附件被覆盖。ignoreId 为改名中的附件 */
  private async checkPath(projectId: string, path: string, ignoreId: string) {
    const [files, others] = await Promise.all([
      this.prisma.file.findMany({ where: { projectId }, select: { path: true } }),
      this.prisma.attachment.findMany({ where: { projectId, id: { not: ignoreId } }, select: { path: true } }),
    ]);
    const lower = path.toLowerCase();
    if (others.some((a) => a.path.toLowerCase() === lower)) throw fail('ATTACHMENT_PATH_CONFLICT', { path });
    const hit = attachmentConflict(path, files.map((f) => f.path), others.map((a) => a.path));
    if (hit) throw fail(hit === 'locked' ? 'ATTACHMENT_PATH_LOCKED' : 'ATTACHMENT_PATH_CONFLICT', { path });
  }

  private async plan(projectId: string, dir: string, uploads: AttachmentUpload[]) {
    const base = dir.trim() ? normalizeAttachmentPath(dir) : '';
    if (base === null) throw fail('ATTACHMENT_PATH_INVALID', { path: dir });
    const [files, existing] = await Promise.all([
      this.prisma.file.findMany({ where: { projectId }, select: { path: true } }),
      this.prisma.attachment.findMany({ where: { projectId }, select: { id: true, path: true, storageKey: true, editStorageKey: true } }),
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

  /** keepEdits：覆盖时保留这些路径上已有的预编辑，其余同名附件的预编辑会被丢弃 */
  async upload(projectId: string, userId: string, dir: string, uploads: AttachmentUpload[], keepEdits: string[] = []) {
    const keep = new Set(keepEdits.map((p) => p.toLowerCase()));
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
        const dropEdit = !keep.has(path.toLowerCase());
        await this.prisma.attachment.update({
          where: { id: existing.id },
          data: dropEdit ? { ...data, editStorageKey: null, editSize: null, editedAt: null, editedById: null } : data,
        });
        if (existing.storageKey !== storageKey) await this.removeBlobIfUnused(existing.storageKey);
        if (dropEdit && existing.editStorageKey) await this.removeBlobIfUnused(existing.editStorageKey);
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
    await this.deleteOne(a);
    await this.activity.log(projectId, userId, 'attachment.delete', { path: a.path });
  }

  async removeMany(projectId: string, ids: string[], userId: string) {
    const list = await this.prisma.attachment.findMany({ where: { projectId, id: { in: ids } } });
    for (const a of list) await this.deleteOne(a);
    if (list.length) await this.activity.log(projectId, userId, 'attachment.deleteMany', { count: list.length });
    return { deleted: list.length };
  }

  private async deleteOne(a: { id: string; storageKey: string; editStorageKey: string | null }) {
    await this.prisma.attachment.delete({ where: { id: a.id } });
    await this.removeBlobIfUnused(a.storageKey);
    if (a.editStorageKey) await this.removeBlobIfUnused(a.editStorageKey);
  }

  /** 改名或移动到其他目录 */
  async rename(projectId: string, id: string, rawPath: string, userId: string) {
    const a = await this.get(projectId, id);
    const path = normalizeAttachmentPath(rawPath);
    if (!path) throw fail('ATTACHMENT_PATH_INVALID', { path: rawPath });
    if (path === a.path) return this.prisma.attachment.findUniqueOrThrow({ where: { id }, select: SELECT });
    await this.checkPath(projectId, path, id);
    const updated = await this.prisma.attachment.update({ where: { id }, data: { path }, select: SELECT });
    await this.activity.log(projectId, userId, 'attachment.rename', { from: a.path, to: path });
    return updated;
  }

  /** 读取原件或预编辑后的内容；未指定时为导出时使用的版本 */
  async content(projectId: string, id: string, version?: string) {
    const a = await this.get(projectId, id);
    const edited = version === 'edited' || (version !== 'original' && !!a.editStorageKey);
    if (edited && !a.editStorageKey) throw fail('NOT_FOUND');
    return { attachment: a, key: edited ? a.editStorageKey! : a.storageKey, size: edited ? a.editSize! : a.size };
  }

  /**
   * 保存预编辑（原件不变，导出时使用）。保留原件的 BOM 与换行符；内容与原件相同时撤销预编辑。
   */
  async saveEdit(projectId: string, id: string, content: string, userId: string) {
    const a = await this.get(projectId, id);
    if (!isTextPath(a.path) || a.size > PREEDIT_MAX_BYTES) throw fail('PREEDIT_NOT_TEXT');
    let original: string;
    try {
      original = utf8.decode(await this.storage.read(a.storageKey));
    } catch {
      throw fail('PREEDIT_NOT_TEXT');
    }
    let text = content.replace(/^\uFEFF/, '');
    if (original.includes('\r\n') && !text.includes('\r')) text = text.replace(/\n/g, '\r\n');
    if (original.startsWith('\uFEFF')) text = `\uFEFF${text}`;
    if (text === original) return this.clearEdit(projectId, id, userId);
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > PREEDIT_MAX_BYTES) throw fail('PREEDIT_NOT_TEXT');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const key = `projects/${projectId}/attachments/${sha}`;
    if (!(await this.storage.exists(key))) await this.storage.put(key, bytes);
    const updated = await this.prisma.attachment.update({
      where: { id },
      data: { editStorageKey: key, editSize: bytes.length, editedAt: new Date(), editedById: userId },
      select: SELECT,
    });
    if (a.editStorageKey && a.editStorageKey !== key) await this.removeBlobIfUnused(a.editStorageKey);
    await this.activity.log(projectId, userId, 'attachment.preedit', { path: a.path });
    return updated;
  }

  async clearEdit(projectId: string, id: string, userId: string) {
    const a = await this.get(projectId, id);
    const updated = await this.prisma.attachment.update({
      where: { id },
      data: { editStorageKey: null, editSize: null, editedAt: null, editedById: null },
      select: SELECT,
    });
    if (a.editStorageKey) {
      await this.removeBlobIfUnused(a.editStorageKey);
      await this.activity.log(projectId, userId, 'attachment.preeditClear', { path: a.path });
    }
    return updated;
  }

  /** 内容相同的附件（含预编辑）共用一份存储 */
  private async removeBlobIfUnused(key: string) {
    const used = await this.prisma.attachment.count({ where: { OR: [{ storageKey: key }, { editStorageKey: key }] } });
    if (!used) await this.storage.remove(key);
  }
}
