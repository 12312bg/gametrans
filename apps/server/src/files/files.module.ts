import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({ imports: [JobsModule], controllers: [FilesController], providers: [FilesService] })
export class FilesModule {}
