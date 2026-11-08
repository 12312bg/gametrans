import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ExportsController } from './exports.controller';

@Module({ imports: [JobsModule], controllers: [ExportsController] })
export class ExportsModule {}
