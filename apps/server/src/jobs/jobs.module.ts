import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ContextBackfillService } from './context-backfill.service';
import { ExportService } from './export.service';
import { JobsController } from './jobs.controller';
import { JobsProcessor } from './jobs.processor';
import { JOB_QUEUE, JobsService } from './jobs.service';
import { ParseService } from './parse.service';

@Module({
  imports: [BullModule.registerQueue({ name: JOB_QUEUE })],
  controllers: [JobsController],
  providers: [JobsService, ParseService, ExportService, JobsProcessor, ContextBackfillService],
  exports: [JobsService],
})
export class JobsModule {}
