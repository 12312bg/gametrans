import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
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
}

export interface ExportPayload {
  fileIds?: string[];
  stages: string[];
  includeJson: boolean;
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
    @InjectQueue(JOB_QUEUE) private readonly queue: Queue,
  ) {}

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
