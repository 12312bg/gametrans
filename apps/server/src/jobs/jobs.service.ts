import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const JOB_QUEUE = 'gametrans-jobs';

export interface ParseUpload {
  /** 存储目录内的临时文件 key */
  tmpKey: string;
  /** 浏览器提交的相对路径（文件夹上传）或文件名 */
  name: string;
}

export interface ParsePayload {
  uploads: ParseUpload[];
  /** 替换指定文件（更新原文） */
  replaceFileId?: string;
}

export interface ExportPayload {
  fileIds?: string[];
  stages: string[];
  includeJson: boolean;
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
}
