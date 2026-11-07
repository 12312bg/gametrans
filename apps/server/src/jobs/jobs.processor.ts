import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job as BullJob } from 'bullmq';
import { ActivityService } from '../common/activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExportService } from './export.service';
import { JOB_QUEUE } from './jobs.service';
import { ParseService } from './parse.service';

/** 单实例部署：同一时间只处理一个任务，避免同一项目的解析任务互相干扰 */
@Processor(JOB_QUEUE, { concurrency: Number(process.env.JOB_CONCURRENCY ?? 1) })
export class JobsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parse: ParseService,
    private readonly exporter: ExportService,
    private readonly activity: ActivityService,
  ) {
    super();
  }

  /** 服务重启时，把上次中断的任务标记为失败 */
  async onModuleInit() {
    const res = await this.prisma.job.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'FAILED', error: '服务重启，任务中断，请重新提交', finishedAt: new Date() },
    });
    if (res.count) this.logger.warn(`已将 ${res.count} 个中断的任务标记为失败`);
  }

  async process(bj: BullJob<{ jobId: string }>): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id: bj.data.jobId } });
    if (!job || job.status !== 'QUEUED') return;
    await this.prisma.job.update({ where: { id: job.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    let last = 0;
    const progress = async (pct: number) => {
      if (pct - last < 5 && pct < 100) return;
      last = pct;
      await this.prisma.job.update({ where: { id: job.id }, data: { progress: pct } });
    };
    try {
      const result = job.type === 'PARSE' ? await this.parse.run(job, progress) : await this.exporter.run(job, progress);
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          result: result as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      if (job.type === 'EXPORT') {
        await this.activity.log(job.projectId, job.createdById, 'export.create', '生成了导出包');
      }
    } catch (e) {
      this.logger.error(`任务 ${job.id} 失败`, (e as Error).stack);
      await this.prisma.job.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: (e as Error).message, finishedAt: new Date() },
      });
    }
  }
}
