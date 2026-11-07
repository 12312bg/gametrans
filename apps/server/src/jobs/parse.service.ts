import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { ExtractedEntry, UnsupportedFileError, extractEntries, normalizeGamePath } from '@gametrans/rpgmaker';
import type { Engine } from '@gametrans/shared';
import { Job, Prisma, Project, Stage } from '@prisma/client';
import { ActivityService } from '../common/activity.service';
import { chunk } from '../common/pagination';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ParsePayload } from './jobs.service';

export interface FileImportResult {
  path: string;
  status: 'created' | 'updated' | 'unchanged';
  total: number;
  added: number;
  changed: number;
  removed: number;
}

export interface ParseResult {
  files: FileImportResult[];
  skipped: { name: string; reason: string }[];
  errors: { name: string; message: string }[];
}

function formatOf(path: string): string {
  if (/\.json$/i.test(path)) return 'mvmz-json';
  if (/\.js$/i.test(path)) return 'mvmz-plugins';
  return 'rgss-marshal';
}

@Injectable()
export class ParseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  async run(job: Job, progress: (pct: number) => Promise<void>): Promise<ParseResult> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: job.projectId } });
    const engine = project.engine as Engine;
    const payload = job.payload as unknown as ParsePayload;
    const result: ParseResult = { files: [], skipped: [], errors: [] };
    const candidates = new Map<string, Uint8Array>();

    try {
      for (const up of payload.uploads) {
        const data = await this.storage.read(up.tmpKey);
        if (/\.zip$/i.test(up.name)) {
          let files: Record<string, Uint8Array>;
          try {
            files = unzipSync(data, { filter: (f) => normalizeGamePath(f.name, engine) !== null });
          } catch {
            result.skipped.push({ name: up.name, reason: '压缩包损坏或格式不受支持' });
            continue;
          }
          const names = Object.keys(files);
          if (!names.length) result.skipped.push({ name: up.name, reason: '压缩包中没有找到该引擎的数据文件' });
          for (const name of names) candidates.set(normalizeGamePath(name, engine)!, files[name]);
        } else if (payload.replaceFileId) {
          const file = await this.prisma.file.findFirst({ where: { id: payload.replaceFileId, projectId: project.id } });
          if (!file) throw new Error('要替换的文件不存在');
          candidates.set(file.path, data);
        } else {
          const path = normalizeGamePath(up.name, engine);
          if (!path) {
            result.skipped.push({ name: up.name, reason: '不是该引擎可翻译的数据文件' });
            continue;
          }
          candidates.set(path, data);
        }
      }

      const list = [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b));
      let done = 0;
      for (const [path, data] of list) {
        try {
          const r = await this.importFile(project, path, data, job.createdById);
          if (r) result.files.push(r);
          else result.skipped.push({ name: path, reason: '没有可翻译的文本' });
        } catch (e) {
          const message = e instanceof UnsupportedFileError ? e.message : `解析失败：${(e as Error).message}`;
          result.errors.push({ name: path, message });
        }
        done++;
        await progress(Math.round((done / list.length) * 100));
      }
    } finally {
      for (const up of payload.uploads) await this.storage.remove(up.tmpKey);
    }

    const created = result.files.filter((f) => f.status === 'created').length;
    const updated = result.files.filter((f) => f.status === 'updated').length;
    if (created || updated) {
      await this.activity.log(
        project.id,
        job.createdById,
        payload.replaceFileId ? 'file.update' : 'file.upload',
        `上传文件：新增 ${created} 个，更新 ${updated} 个`,
      );
      await this.prisma.project.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    }
    return result;
  }

  /** 导入单个文件：保存原文件、合并词条。没有文本的新文件返回 null */
  async importFile(project: Project, path: string, data: Uint8Array, userId: string | null): Promise<FileImportResult | null> {
    const { kind, entries, warnings } = extractEntries(path, data, project.engine as Engine);
    const existing = await this.prisma.file.findUnique({ where: { projectId_path: { projectId: project.id, path } } });
    if (!existing && entries.length === 0) return null;
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (existing && existing.sha256 === sha256) {
      return { path, status: 'unchanged', total: entries.length, added: 0, changed: 0, removed: 0 };
    }
    const storageKey = `projects/${project.id}/files/${sha256}`;
    await this.storage.put(storageKey, data);
    const fileData = { kind, format: formatOf(path), storageKey, size: data.length, sha256, warnings };
    const file = existing
      ? await this.prisma.file.update({ where: { id: existing.id }, data: fileData })
      : await this.prisma.file.create({ data: { projectId: project.id, path, ...fileData } });
    const stats = await this.mergeEntries(project.id, file.id, entries, userId);
    if (existing && existing.storageKey !== storageKey) {
      const stillUsed = await this.prisma.file.count({ where: { storageKey: existing.storageKey } });
      if (!stillUsed) await this.storage.remove(existing.storageKey);
    }
    return { path, status: existing ? 'updated' : 'created', total: entries.length, ...stats };
  }

  /**
   * 合并词条：
   * 1. 键相同且原文相同 → 保留译文，仅更新上下文与排序
   * 2. 键相同但原文变化 → 保留译文，状态改为「有疑问」（无译文则为未翻译），记录历史
   * 3. 键不存在 → 尝试按原文匹配旧词条（处理指令增删导致的下标偏移）
   * 4. 仍未匹配 → 新建（危险文本默认隐藏）；旧文件中多余的词条删除
   */
  private async mergeEntries(projectId: string, fileId: string, extracted: ExtractedEntry[], userId: string | null) {
    const existing = await this.prisma.entry.findMany({
      where: { fileId },
      select: { id: true, key: true, original: true, translation: true, stage: true, context: true, category: true, danger: true, sortOrder: true },
    });
    const byKey = new Map(existing.map((e) => [e.key, e]));
    const used = new Set<string>();
    const meta: { id: string; sortOrder: number; context: string; category: string; danger: boolean; key: string }[] = [];
    const sourceChanged: { id: string; original: string; oldOriginal: string; translation: string; stage: Stage }[] = [];
    const pending: { e: ExtractedEntry; order: number }[] = [];

    extracted.forEach((e, order) => {
      const ex = byKey.get(e.key);
      if (!ex) {
        pending.push({ e, order });
        return;
      }
      used.add(ex.id);
      if (ex.original !== e.original) {
        const stage: Stage = ex.stage === 'HIDDEN' ? 'HIDDEN' : ex.translation ? 'QUESTIONED' : 'UNTRANSLATED';
        sourceChanged.push({ id: ex.id, original: e.original, oldOriginal: ex.original, translation: ex.translation, stage });
      }
      if (ex.sortOrder !== order || ex.context !== e.context || ex.category !== e.category || ex.danger !== e.danger) {
        meta.push({ id: ex.id, sortOrder: order, context: e.context, category: e.category, danger: e.danger, key: e.key });
      }
    });

    const unusedByOriginal = new Map<string, typeof existing>();
    for (const ex of existing) {
      if (used.has(ex.id)) continue;
      const arr = unusedByOriginal.get(ex.original) ?? [];
      arr.push(ex);
      unusedByOriginal.set(ex.original, arr);
    }
    const creates: Prisma.EntryCreateManyInput[] = [];
    for (const { e, order } of pending) {
      const cand = unusedByOriginal.get(e.original)?.shift();
      if (cand) {
        used.add(cand.id);
        meta.push({ id: cand.id, sortOrder: order, context: e.context, category: e.category, danger: e.danger, key: e.key });
        continue;
      }
      creates.push({
        projectId,
        fileId,
        key: e.key,
        original: e.original,
        context: e.context,
        category: e.category,
        danger: e.danger,
        stage: e.danger ? 'HIDDEN' : 'UNTRANSLATED',
        sortOrder: order,
      });
    }
    const removeIds = existing.filter((ex) => !used.has(ex.id)).map((ex) => ex.id);

    await this.prisma.$transaction(
      async (tx) => {
        for (const ids of chunk(removeIds, 5000)) await tx.entry.deleteMany({ where: { id: { in: ids } } });
        for (const part of chunk(meta, 5000)) {
          await tx.$executeRaw`
            UPDATE "Entry" AS e
            SET "sortOrder" = v.o, "context" = v.c, "category" = v.cat, "danger" = v.d, "key" = v.k
            FROM (
              SELECT unnest(${part.map((m) => m.id)}::text[]) AS id,
                     unnest(${part.map((m) => m.sortOrder)}::int[]) AS o,
                     unnest(${part.map((m) => m.context)}::text[]) AS c,
                     unnest(${part.map((m) => m.category)}::text[]) AS cat,
                     unnest(${part.map((m) => m.danger)}::boolean[]) AS d,
                     unnest(${part.map((m) => m.key)}::text[]) AS k
            ) AS v
            WHERE e.id = v.id`;
        }
        for (const s of sourceChanged) {
          await tx.entry.update({
            where: { id: s.id },
            data: { original: s.original, stage: s.stage, version: { increment: 1 }, updatedAt: new Date() },
          });
        }
        for (const part of chunk(sourceChanged, 2000)) {
          await tx.entryHistory.createMany({
            data: part.map((s) => ({
              entryId: s.id,
              projectId,
              userId,
              action: 'SOURCE_CHANGED',
              translation: s.translation,
              stage: s.stage,
              note: s.oldOriginal,
            })),
          });
        }
        for (const part of chunk(creates, 2000)) await tx.entry.createMany({ data: part });
      },
      { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
    );
    return { added: creates.length, changed: sourceChanged.length, removed: removeIds.length };
  }
}
