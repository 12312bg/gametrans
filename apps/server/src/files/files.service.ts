import { Injectable } from '@nestjs/common';
import { JsonChange, UnsupportedFileError, applyPreEdit, computePatch, editableText, editableView, isPreEditable, preEditTouchedEntries } from '@gametrans/rpgmaker';
import type { Engine } from '@gametrans/shared';
import { Prisma } from '@prisma/client';
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
    return files.map(({ storageKey: _k, editPatch, editedById: _e, ...f }) => ({ ...f, edited: Array.isArray(editPatch) && editPatch.length > 0, stats: counts.get(f.id) ?? emptyCounts() }));
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

  /** 预编辑：编辑器中显示的原文件与预编辑后的内容（易读格式） */
  async getEdit(pid: string, fid: string) {
    const file = await this.get(pid, fid);
    if (!isPreEditable(file.path)) return { editable: false, original: null, edited: null, changes: 0, conflicts: 0, editedAt: null, editedBy: null };
    const bytes = await this.storage.read(file.storageKey);
    const patch = (file.editPatch as unknown as JsonChange[] | null) ?? [];
    const editedBy = file.editedById ? await this.prisma.user.findUnique({ where: { id: file.editedById }, select: { id: true, username: true, displayName: true } }) : null;
    const view = patch.length ? editableView(file.path, bytes, patch) : null;
    return {
      editable: true,
      original: editableText(file.path, bytes),
      edited: view?.text ?? null,
      changes: patch.length,
      conflicts: view?.conflicts ?? 0,
      editedAt: file.editedAt,
      editedBy,
    };
  }

  /** 保存预编辑：以相对原文件的字段变更保存，不能改动已提取的词条 */
  async saveEdit(pid: string, fid: string, content: string, userId: string) {
    const file = await this.get(pid, fid);
    if (!isPreEditable(file.path)) throw fail('PREEDIT_UNSUPPORTED');
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: pid }, select: { engine: true } });
    const bytes = await this.storage.read(file.storageKey);
    let patch: JsonChange[];
    try {
      patch = computePatch(file.path, bytes, content);
    } catch (e) {
      if (e instanceof UnsupportedFileError) throw fail(e.code === 'PREEDIT_INVALID_JSON' ? 'PREEDIT_INVALID_JSON' : 'PREEDIT_UNSUPPORTED', e.params);
      throw e;
    }
    if (!patch.length) return this.clearEdit(pid, fid, userId);
    const touched = preEditTouchedEntries(file.path, bytes, project.engine as Engine, patch);
    if (touched.length) throw fail('PREEDIT_TOUCHES_ENTRIES', { count: touched.length, key: touched[0].key }, { touched: touched.slice(0, 20) });
    await this.prisma.file.update({ where: { id: fid }, data: { editPatch: patch as unknown as Prisma.InputJsonValue, editedAt: new Date(), editedById: userId } });
    await this.activity.log(pid, userId, 'file.preedit', { path: file.path });
    return this.getEdit(pid, fid);
  }

  async clearEdit(pid: string, fid: string, userId: string) {
    const file = await this.get(pid, fid);
    if (file.editPatch) {
      await this.prisma.file.update({ where: { id: fid }, data: { editPatch: Prisma.DbNull, editedAt: null, editedById: null } });
      await this.activity.log(pid, userId, 'file.preeditClear', { path: file.path });
    }
    return this.getEdit(pid, fid);
  }

  /** 应用预编辑后的文件内容（未预编辑时为原文件） */
  async editedBytes(pid: string, fid: string) {
    const file = await this.get(pid, fid);
    const bytes = await this.storage.read(file.storageKey);
    const patch = (file.editPatch as unknown as JsonChange[] | null) ?? [];
    return { file, data: patch.length ? applyPreEdit(file.path, bytes, patch).data : bytes };
  }

  /** 校验失败时清理已落盘的临时文件 */
  async discard(files: Express.Multer.File[] | undefined) {
    for (const f of files ?? []) await this.storage.remove(`tmp/${f.filename}`);
  }
}
