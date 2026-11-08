import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ExtractedEntry, UnsupportedFileError, extractEntries } from '@gametrans/rpgmaker';
import { Engine, Issue, contextSearchText, normalizeGamePath } from '@gametrans/shared';
import { Job, Prisma, Project, Stage } from '@prisma/client';
import { ActivityService } from '../common/activity.service';
import { chunk } from '../common/query';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobError, ParsePayload } from './jobs.service';
import { readZip } from './zip';

export interface FileImportResult {
  path: string;
  status: 'created' | 'updated' | 'unchanged';
  total: number;
  added: number;
  changed: number;
  removed: number;
}

/** 预览中列出的词条明细，每类最多 PREVIEW_ITEMS 条 */
export interface FilePreview extends FileImportResult {
  /** 将被删除且已有译文的词条数 */
  removedTranslated: number;
  details: {
    added: { key: string; original: string; category: string }[];
    changed: { key: string; before: string; after: string; translation: string; stage: Stage }[];
    removed: { key: string; original: string; translation: string; stage: Stage }[];
  };
}

/** skipped / errors 的 code 对应 i18n 的 issue.<code> */
export interface ParseResult {
  /** 预览任务：只计算变更，不写入 */
  preview?: boolean;
  files: (FileImportResult | FilePreview)[];
  skipped: (Issue & { name: string })[];
  errors: (Issue & { name: string })[];
}

/** 待导入的文件：路径与按需读取内容的函数 */
type Source = readonly [string, () => Promise<Uint8Array>];

const PREVIEW_ITEMS = 100;

const EXISTING_SELECT = { id: true, key: true, original: true, translation: true, stage: true, contextData: true, category: true, danger: true, sortOrder: true } as const;
type ExistingEntry = Prisma.EntryGetPayload<{ select: typeof EXISTING_SELECT }>;

interface MetaRow {
  id: string;
  sortOrder: number;
  context: string;
  search: string;
  category: string;
  danger: boolean;
  key: string;
}

/** 合并方案：由新旧词条计算得出，预览与实际导入共用 */
interface MergePlan {
  meta: MetaRow[];
  sourceChanged: { id: string; key: string; original: string; oldOriginal: string; translation: string; stage: Stage }[];
  creates: { e: ExtractedEntry; order: number }[];
  removed: ExistingEntry[];
}

const formatOf = (path: string) => (/\.json$/i.test(path) ? 'mvmz-json' : /\.js$/i.test(path) ? 'mvmz-plugins' : 'rgss-marshal');
const json = (v: unknown) => v as Prisma.InputJsonValue;

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
    const preview = !!payload.preview;
    const result: ParseResult = { ...(preview ? { preview } : {}), files: [], skipped: [], errors: [] };

    let ok = false;
    try {
      const sources = payload.reextract ? await this.storedFiles(project.id) : await this.uploadedFiles(project, engine, payload, result);
      for (const [i, [path, load]] of sources.entries()) {
        try {
          const data = await load();
          const r = preview ? await this.previewFile(project, path, data) : await this.importFile(project, path, data, job.createdById, !!payload.reextract);
          if (r) result.files.push(r);
          else result.skipped.push({ name: path, code: 'NO_TEXT' });
        } catch (e) {
          result.errors.push(
            e instanceof UnsupportedFileError
              ? { name: path, code: e.code, params: e.params }
              : { name: path, code: 'FAILED', params: { detail: (e as Error).message } },
          );
        }
        await progress(Math.round(((i + 1) / sources.length) * 100));
      }
      ok = true;
    } finally {
      // 预览成功时保留临时文件，确认导入时复用
      if (!preview || !ok) for (const up of payload.uploads) await this.storage.remove(up.tmpKey);
    }
    if (preview) return result;

    const created = result.files.filter((f) => f.status === 'created').length;
    const updated = result.files.filter((f) => f.status === 'updated').length;
    if (created || updated) {
      if (payload.reextract) {
        const sum = (k: 'added' | 'removed') => result.files.reduce((n, f) => n + f[k], 0);
        await this.activity.log(project.id, job.createdById, 'file.reextract', { files: result.files.length, added: sum('added'), removed: sum('removed') });
      } else {
        await this.activity.log(project.id, job.createdById, payload.replaceFileId ? 'file.update' : 'file.upload', { created, updated });
      }
      await this.prisma.project.update({ where: { id: project.id }, data: { updatedAt: new Date() } });
    }
    return result;
  }

  private async storedFiles(projectId: string): Promise<Source[]> {
    const files = await this.prisma.file.findMany({ where: { projectId }, orderBy: { path: 'asc' }, select: { path: true, storageKey: true } });
    return files.map((f) => [f.path, () => this.storage.read(f.storageKey)]);
  }

  private async uploadedFiles(project: Project, engine: Engine, payload: ParsePayload, result: ParseResult): Promise<Source[]> {
    const candidates = await this.collect(project, engine, payload, result);
    return [...candidates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, async () => data]);
  }

  /** 收集待导入的文件：zip 流式解压，只取该引擎的数据文件 */
  private async collect(project: Project, engine: Engine, payload: ParsePayload, result: ParseResult) {
    const candidates = new Map<string, Uint8Array>();
    for (const up of payload.uploads) {
      if (/\.zip$/i.test(up.name)) {
        let files: Map<string, Uint8Array>;
        try {
          files = await readZip(this.storage.resolve(up.tmpKey), (name) => normalizeGamePath(name, engine));
        } catch {
          result.skipped.push({ name: up.name, code: 'ZIP_INVALID' });
          continue;
        }
        if (!files.size) result.skipped.push({ name: up.name, code: 'ZIP_NO_DATA' });
        for (const [path, data] of files) candidates.set(path, data);
      } else if (payload.replaceFileId) {
        const file = await this.prisma.file.findFirst({ where: { id: payload.replaceFileId, projectId: project.id } });
        if (!file) throw new JobError('REPLACE_TARGET_MISSING');
        candidates.set(file.path, await this.storage.read(up.tmpKey));
      } else {
        const path = normalizeGamePath(up.name, engine);
        if (path) candidates.set(path, await this.storage.read(up.tmpKey));
        else result.skipped.push({ name: up.name, code: 'NOT_DATA_FILE' });
      }
    }
    return candidates;
  }

  /** 只计算导入后的变化，不写入数据库与存储 */
  async previewFile(project: Project, path: string, data: Uint8Array): Promise<FilePreview | null> {
    const { entries } = extractEntries(path, data, project.engine as Engine);
    const existing = await this.prisma.file.findUnique({ where: { projectId_path: { projectId: project.id, path } } });
    if (!existing && !entries.length) return null;
    const base = { path, total: entries.length, added: 0, changed: 0, removed: 0, removedTranslated: 0, details: { added: [], changed: [], removed: [] } };
    if (!existing) return { ...base, status: 'created', added: entries.length };
    if (existing.sha256 === createHash('sha256').update(data).digest('hex')) return { ...base, status: 'unchanged' };

    const plan = this.planMerge(await this.loadExisting(existing.id), entries);
    // 有译文的删除项排在前面，明细截断时优先展示
    const removed = [...plan.removed].sort((a, b) => Number(!!b.translation) - Number(!!a.translation));
    return {
      ...base,
      status: plan.creates.length + plan.sourceChanged.length + plan.removed.length ? 'updated' : 'unchanged',
      added: plan.creates.length,
      changed: plan.sourceChanged.length,
      removed: plan.removed.length,
      removedTranslated: plan.removed.filter((r) => r.translation).length,
      details: {
        added: plan.creates.slice(0, PREVIEW_ITEMS).map(({ e }) => ({ key: e.key, original: e.original, category: e.category })),
        changed: plan.sourceChanged.slice(0, PREVIEW_ITEMS).map((c) => ({ key: c.key, before: c.oldOriginal, after: c.original, translation: c.translation, stage: c.stage })),
        removed: removed.slice(0, PREVIEW_ITEMS).map((r) => ({ key: r.key, original: r.original, translation: r.translation, stage: r.stage as Stage })),
      },
    };
  }

  /**
   * 保存原文件并合并词条；没有文本的新文件返回 null。
   * 文件内容未变时跳过，除非 reextract（提取规则更新后重新合并）。
   */
  async importFile(project: Project, path: string, data: Uint8Array, userId: string | null, reextract = false): Promise<FileImportResult | null> {
    const { kind, entries, warnings } = extractEntries(path, data, project.engine as Engine);
    const existing = await this.prisma.file.findUnique({ where: { projectId_path: { projectId: project.id, path } } });
    if (!existing && !entries.length) return null;
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (existing?.sha256 === sha256) {
      if (!reextract) return { path, status: 'unchanged', total: entries.length, added: 0, changed: 0, removed: 0 };
      await this.prisma.file.update({ where: { id: existing.id }, data: { kind, warnings: json(warnings) } });
      const stats = await this.mergeEntries(project.id, existing.id, entries, userId);
      const touched = stats.added + stats.changed + stats.removed > 0;
      return { path, status: touched ? 'updated' : 'unchanged', total: entries.length, ...stats };
    }

    const storageKey = `projects/${project.id}/files/${sha256}`;
    await this.storage.put(storageKey, data);
    const fileData = { kind, format: formatOf(path), storageKey, size: data.length, sha256, warnings: json(warnings) };
    const file = existing
      ? await this.prisma.file.update({ where: { id: existing.id }, data: fileData })
      : await this.prisma.file.create({ data: { projectId: project.id, path, ...fileData } });
    const stats = await this.mergeEntries(project.id, file.id, entries, userId);
    if (existing && existing.storageKey !== storageKey && !(await this.prisma.file.count({ where: { storageKey: existing.storageKey } }))) {
      await this.storage.remove(existing.storageKey);
    }
    return { path, status: existing ? 'updated' : 'created', total: entries.length, ...stats };
  }

  private loadExisting(fileId: string) {
    return this.prisma.entry.findMany({ where: { fileId }, select: EXISTING_SELECT, orderBy: { sortOrder: 'asc' } });
  }

  /**
   * 合并词条：
   * 键与原文都相同 → 保留译文，只更新位置与排序；
   * 键相同但原文变化 → 保留译文，标记「有疑问」（无译文则为未翻译）并记录历史；
   * 键不存在 → 按原文匹配旧词条（应对指令增删导致的下标偏移），仍未匹配则新建（危险文本默认隐藏）；
   * 多余的旧词条删除。
   */
  private planMerge(existing: ExistingEntry[], extracted: ExtractedEntry[]): MergePlan {
    const byKey = new Map(existing.map((e) => [e.key, e]));
    const used = new Set<string>();
    const plan: MergePlan = { meta: [], sourceChanged: [], creates: [], removed: [] };
    const pending: { e: ExtractedEntry; order: number }[] = [];
    const metaOf = (id: string, e: ExtractedEntry, order: number): MetaRow => ({
      id,
      sortOrder: order,
      context: JSON.stringify(e.context),
      search: contextSearchText(e.context),
      category: e.category,
      danger: e.danger,
      key: e.key,
    });

    extracted.forEach((e, order) => {
      const ex = byKey.get(e.key);
      if (!ex) return pending.push({ e, order });
      used.add(ex.id);
      if (ex.original !== e.original) {
        const stage: Stage = ex.stage === 'HIDDEN' ? 'HIDDEN' : ex.translation ? 'QUESTIONED' : 'UNTRANSLATED';
        plan.sourceChanged.push({ id: ex.id, key: e.key, original: e.original, oldOriginal: ex.original, translation: ex.translation, stage });
      }
      const contextChanged = JSON.stringify(ex.contextData) !== JSON.stringify(e.context);
      if (ex.sortOrder !== order || contextChanged || ex.category !== e.category || ex.danger !== e.danger) plan.meta.push(metaOf(ex.id, e, order));
    });

    const unusedByOriginal = new Map<string, ExistingEntry[]>();
    for (const ex of existing) {
      if (used.has(ex.id)) continue;
      unusedByOriginal.set(ex.original, [...(unusedByOriginal.get(ex.original) ?? []), ex]);
    }
    for (const p of pending) {
      const cand = unusedByOriginal.get(p.e.original)?.shift();
      if (cand) {
        used.add(cand.id);
        plan.meta.push(metaOf(cand.id, p.e, p.order));
      } else {
        plan.creates.push(p);
      }
    }
    plan.removed = existing.filter((ex) => !used.has(ex.id));
    return plan;
  }

  private async mergeEntries(projectId: string, fileId: string, extracted: ExtractedEntry[], userId: string | null) {
    const { meta, sourceChanged, creates: planned, removed } = this.planMerge(await this.loadExisting(fileId), extracted);
    const removeIds = removed.map((r) => r.id);
    const creates: Prisma.EntryCreateManyInput[] = planned.map(({ e, order }) => ({
      projectId,
      fileId,
      key: e.key,
      original: e.original,
      contextData: json(e.context),
      contextSearch: contextSearchText(e.context),
      category: e.category,
      danger: e.danger,
      stage: e.danger ? 'HIDDEN' : 'UNTRANSLATED',
      sortOrder: order,
    }));

    await this.prisma.$transaction(
      async (tx) => {
        for (const ids of chunk(removeIds, 5000)) await tx.entry.deleteMany({ where: { id: { in: ids } } });
        for (const part of chunk(meta, 5000)) {
          await tx.$executeRaw`
            UPDATE "Entry" AS e
            SET "sortOrder" = v.o, "contextData" = v.c::jsonb, "contextSearch" = v.s, "category" = v.cat, "danger" = v.d, "key" = v.k
            FROM (
              SELECT unnest(${part.map((m) => m.id)}::text[]) AS id,
                     unnest(${part.map((m) => m.sortOrder)}::int[]) AS o,
                     unnest(${part.map((m) => m.context)}::text[]) AS c,
                     unnest(${part.map((m) => m.search)}::text[]) AS s,
                     unnest(${part.map((m) => m.category)}::text[]) AS cat,
                     unnest(${part.map((m) => m.danger)}::boolean[]) AS d,
                     unnest(${part.map((m) => m.key)}::text[]) AS k
            ) AS v
            WHERE e.id = v.id`;
        }
        for (const s of sourceChanged) {
          await tx.entry.update({ where: { id: s.id }, data: { original: s.original, stage: s.stage, version: { increment: 1 }, updatedAt: new Date() } });
        }
        for (const part of chunk(sourceChanged, 2000)) {
          await tx.entryHistory.createMany({
            data: part.map((s) => ({ entryId: s.id, projectId, userId, action: 'SOURCE_CHANGED', translation: s.translation, stage: s.stage, note: s.oldOriginal })),
          });
        }
        for (const part of chunk(creates, 2000)) await tx.entry.createMany({ data: part });
      },
      { timeout: 10 * 60 * 1000, maxWait: 60 * 1000 },
    );
    return { added: creates.length, changed: sourceChanged.length, removed: removeIds.length };
  }
}
