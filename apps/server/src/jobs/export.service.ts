import { Injectable } from '@nestjs/common';
import { strToU8 } from 'fflate';
import { UnsupportedFileError, applyTranslations } from '@gametrans/rpgmaker';
import { ContextPart, DEFAULT_LOCALE, Engine, Issue, formatContext, isLocale } from '@gametrans/shared';
import { Job, Stage } from '@prisma/client';
import { translator } from '../common/locale';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ExportPayload } from './jobs.service';
import { ZipFileWriter } from './zip-writer';

export interface ExportResult {
  storageKey: string;
  fileName: string;
  size: number;
  fileCount: number;
  applied: number;
  /** 一同导出的附件数 */
  attachmentCount?: number;
  errors: (Issue & { name: string })[];
}

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async run(job: Job, progress: (pct: number) => Promise<void>): Promise<ExportResult> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: job.projectId } });
    const payload = job.payload as unknown as ExportPayload;
    const stages = payload.stages as Stage[];
    const files = await this.prisma.file.findMany({
      where: { projectId: project.id, ...(payload.fileIds?.length ? { id: { in: payload.fileIds } } : {}) },
      orderBy: { path: 'asc' },
    });
    // 译文 JSON 的位置说明按导出者的界面语言渲染
    const creator = job.createdById ? await this.prisma.user.findUnique({ where: { id: job.createdById }, select: { locale: true } }) : null;
    const t = translator(isLocale(creator?.locale) ? creator.locale : DEFAULT_LOCALE);
    const storageKey = `projects/${project.id}/exports/${job.id}.zip`;
    const zip = await ZipFileWriter.open(this.storage.resolve(storageKey));
    const names = new Set<string>();
    const errors: ExportResult['errors'] = [];
    let applied = 0;

    for (const [i, file] of files.entries()) {
      const rows = await this.prisma.entry.findMany({
        where: { fileId: file.id },
        select: { key: true, original: true, translation: true, contextData: true, contextSearch: true, stage: true },
        orderBy: { sortOrder: 'asc' },
      });
      const map = new Map(rows.filter((r) => r.translation !== '' && stages.includes(r.stage)).map((r) => [r.key, r.translation]));
      try {
        const out = applyTranslations(file.path, await this.storage.read(file.storageKey), project.engine as Engine, map);
        zip.addBytes(file.path, out.data);
        names.add(file.path.toLowerCase());
        applied += out.applied;
      } catch (e) {
        errors.push(
          e instanceof UnsupportedFileError
            ? { name: file.path, code: e.code, params: e.params }
            : { name: file.path, code: 'FAILED', params: { detail: (e as Error).message } },
        );
      }
      if (payload.includeJson) {
        // ParaTranz 兼容的译文 JSON
        const items = rows.map((r) => ({
          key: r.key,
          original: r.original,
          translation: r.translation,
          context: r.contextData ? formatContext(r.contextData as unknown as ContextPart[], t) : r.contextSearch,
          stage: r.stage,
        }));
        const name = `translations/${file.path}.json`;
        zip.addBytes(name, strToU8(JSON.stringify(items, null, 2)));
        names.add(name.toLowerCase());
      }
      await progress(Math.round(((i + 1) / Math.max(files.length, 1)) * 90));
    }
    const fileErrors = errors.length;

    let attachmentCount = 0;
    if (payload.includeAttachments !== false) {
      // 数据文件的路径已锁定；即使附件上传后又出现同名数据文件，也以数据文件为准
      const locked = new Set((await this.prisma.file.findMany({ where: { projectId: project.id }, select: { path: true } })).map((f) => f.path.toLowerCase()));
      for (const a of await this.prisma.attachment.findMany({ where: { projectId: project.id }, orderBy: { path: 'asc' } })) {
        const lower = a.path.toLowerCase();
        if (locked.has(lower) || names.has(lower)) {
          errors.push({ name: a.path, code: 'ATTACHMENT_CONFLICT' });
        } else if (!(await this.storage.exists(a.storageKey))) {
          errors.push({ name: a.path, code: 'ATTACHMENT_MISSING' });
        } else {
          await zip.addStream(a.path, this.storage.stream(a.storageKey));
          names.add(lower);
          attachmentCount++;
        }
      }
    }
    const size = await zip.finish();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const safeName = project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'project';
    return { storageKey, fileName: `${safeName}_${project.targetLang}_${stamp}.zip`, size, fileCount: files.length - fileErrors, applied, attachmentCount, errors };
  }
}
