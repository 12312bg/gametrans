import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { fail } from '../common/errors';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma/prisma.service';

export const JOB_QUEUE = 'gametrans-jobs';

export interface ParseUpload {
  /** 存储目录内的临时文件 */
  tmpKey: string;
  /** 浏览器提交的相对路径或文件名 */
  name: string;
}

export interface ParsePayload {
  uploads: ParseUpload[];
  /** 替换指定文件（更新原文） */
  replaceFileId?: string;
  /** 用当前的提取规则重新解析项目中已保存的原文件 */
  reextract?: boolean;
  /** 只计算变更，确认后再导入（临时文件保留到确认、取消或过期） */
  preview?: boolean;
  /** 预览已确认时，执行导入的任务 */
  appliedJobId?: string;
}

/** 未确认的预览保留 24 小时 */
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface ExportPayload {
  fileIds?: string[];
  stages: string[];
  includeJson: boolean;
  /** 一同导出附件，未指定时为 true */
  includeAttachments?: boolean;
}

/** 任务失败原因；code 对应 i18n 的 issue.<code>，存入 Job.error */
export class JobError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(JOB_QUEUE) private readonly queue: Queue,
  ) {}

  private async openPreview(projectId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({ where: { id: jobId, projectId, type: 'PARSE' } });
    const payload = job?.payload as unknown as ParsePayload | undefined;
    if (!job || !payload?.preview || payload.appliedJobId || Date.now() - job.createdAt.getTime() > PREVIEW_TTL_MS) throw fail('PREVIEW_UNAVAILABLE');
    return { job, payload };
  }

  /** 确认预览：复用已上传的临时文件执行导入 */
  async applyPreview(projectId: string, jobId: string, userId: string) {
    const { job, payload } = await this.openPreview(projectId, jobId);
    if (job.status !== 'SUCCEEDED') throw fail('PREVIEW_UNAVAILABLE');
    for (const up of payload.uploads) if (!(await this.storage.exists(up.tmpKey))) throw fail('PREVIEW_UNAVAILABLE');
    const next = await this.enqueue(projectId, 'PARSE', { uploads: payload.uploads, replaceFileId: payload.replaceFileId }, userId);
    await this.prisma.job.update({ where: { id: job.id }, data: { payload: { ...payload, appliedJobId: next.id } as unknown as Prisma.InputJsonValue } });
    return next;
  }

  /** 取消预览：删除临时文件与任务记录 */
  async discardPreview(projectId: string, jobId: string) {
    const { job, payload } = await this.openPreview(projectId, jobId);
    if (job.status === 'RUNNING') throw fail('PREVIEW_UNAVAILABLE');
    await this.prisma.job.delete({ where: { id: job.id } });
    for (const up of payload.uploads) await this.storage.remove(up.tmpKey);
  }

  /** 清理过期且未确认的预览 */
  async cleanupPreviews() {
    const stale = await this.prisma.job.findMany({
      where: { type: 'PARSE', status: { in: ['SUCCEEDED', 'FAILED'] }, createdAt: { lt: new Date(Date.now() - PREVIEW_TTL_MS) }, payload: { path: ['preview'], equals: true } },
    });
    for (const job of stale) {
      const payload = job.payload as unknown as ParsePayload;
      if (payload.appliedJobId) continue;
      for (const up of payload.uploads) await this.storage.remove(up.tmpKey);
      await this.prisma.job.delete({ where: { id: job.id } });
    }
    return stale.length;
  }

  async enqueue(projectId: string, type: 'PARSE' | 'EXPORT', payload: ParsePayload | ExportPayload, userId: string) {
    const job = await this.prisma.job.create({
      data: { projectId, type, payload: payload as unknown as Prisma.InputJsonValue, createdById: userId },
    });
    await this.queue.add(type, { jobId: job.id }, { removeOnComplete: 100, removeOnFail: 100, attempts: 1 });
    return job;
  }

  list(projectId: string, type?: string) {
    return this.prisma.job.findMany({
      where: { projectId, ...(type === 'PARSE' || type === 'EXPORT' ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        payload: true,
        result: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        createdBy: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  get(projectId: string, id: string) {
    return this.prisma.job.findFirst({
      where: { id, projectId },
      select: { id: true, projectId: true, type: true, status: true, progress: true, result: true, error: true, createdAt: true, finishedAt: true },
    });
  }
}
