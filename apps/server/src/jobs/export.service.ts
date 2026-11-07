import { Injectable } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { UnsupportedFileError, applyTranslations } from '@gametrans/rpgmaker';
import { ContextPart, DEFAULT_LOCALE, Engine, Issue, formatContext, isLocale } from '@gametrans/shared';
import { Job, Stage } from '@prisma/client';
import { translator } from '../common/locale';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ExportPayload } from './jobs.service';

export interface ExportResult {
  storageKey: string;
  fileName: string;
  size: number;
  fileCount: number;
  applied: number;
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
    const zipInput: Record<string, Uint8Array> = {};
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
        zipInput[file.path] = out.data;
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
        zipInput[`translations/${file.path}.json`] = strToU8(JSON.stringify(items, null, 2));
      }
      await progress(Math.round(((i + 1) / Math.max(files.length, 1)) * 95));
    }

    const zip = zipSync(zipInput, { level: 6 });
    const storageKey = `projects/${project.id}/exports/${job.id}.zip`;
    await this.storage.put(storageKey, zip);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const safeName = project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'project';
    return { storageKey, fileName: `${safeName}_${project.targetLang}_${stamp}.zip`, size: zip.length, fileCount: files.length - errors.length, applied, errors };
  }
}
