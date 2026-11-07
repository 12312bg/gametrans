import { Injectable } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { applyTranslations } from '@gametrans/rpgmaker';
import type { Engine } from '@gametrans/shared';
import { Job, Stage } from '@prisma/client';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ExportPayload } from './jobs.service';

export interface ExportResult {
  storageKey: string;
  fileName: string;
  size: number;
  fileCount: number;
  applied: number;
  errors: { name: string; message: string }[];
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
    const zipInput: Record<string, Uint8Array> = {};
    const errors: ExportResult['errors'] = [];
    let applied = 0;
    let done = 0;

    for (const file of files) {
      const rows = await this.prisma.entry.findMany({
        where: { fileId: file.id },
        select: { key: true, original: true, translation: true, context: true, stage: true },
        orderBy: { sortOrder: 'asc' },
      });
      const map = new Map<string, string>();
      for (const r of rows) {
        if (r.translation !== '' && stages.includes(r.stage)) map.set(r.key, r.translation);
      }
      try {
        const bytes = await this.storage.read(file.storageKey);
        const out = applyTranslations(file.path, bytes, project.engine as Engine, map);
        zipInput[file.path] = out.data;
        applied += out.applied;
      } catch (e) {
        errors.push({ name: file.path, message: (e as Error).message });
      }
      if (payload.includeJson) {
        // ParaTranz 兼容的译文 JSON
        zipInput[`translations/${file.path}.json`] = strToU8(
          JSON.stringify(
            rows.map((r) => ({ key: r.key, original: r.original, translation: r.translation, context: r.context, stage: r.stage })),
            null,
            2,
          ),
        );
      }
      done++;
      await progress(Math.round((done / Math.max(files.length, 1)) * 95));
    }

    const zip = zipSync(zipInput, { level: 6 });
    const storageKey = `projects/${project.id}/exports/${job.id}.zip`;
    await this.storage.put(storageKey, zip);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const safeName = project.name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'project';
    return {
      storageKey,
      fileName: `${safeName}_${project.targetLang}_${stamp}.zip`,
      size: zip.length,
      fileCount: files.length - errors.length,
      applied,
      errors,
    };
  }
}
