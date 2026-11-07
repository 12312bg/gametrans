import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { config } from './config';
import { EntriesController } from './entries/entries.controller';
import { EntriesService } from './entries/entries.service';
import { ExportsController } from './exports/exports.controller';
import { FilesController } from './files/files.controller';
import { ExportService } from './jobs/export.service';
import { JobsProcessor } from './jobs/jobs.processor';
import { JOB_QUEUE, JobsService } from './jobs/jobs.service';
import { ParseService } from './jobs/parse.service';
import { MembersController } from './members/members.controller';
import { PrismaModule } from './prisma/prisma.service';
import { ProjectsController } from './projects/projects.controller';
import { TermsController } from './terms/terms.controller';
import { UsersController } from './users/users.controller';

function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    JwtModule.register({ global: true, secret: config.jwtSecret }),
    BullModule.forRoot({ connection: redisConnection(config.redisUrl), prefix: 'gametrans' }),
    BullModule.registerQueue({ name: JOB_QUEUE }),
    ...(config.staticDir
      ? [ServeStaticModule.forRoot({ rootPath: config.staticDir, exclude: ['/api/(.*)'] })]
      : []),
  ],
  controllers: [
    AuthController,
    UsersController,
    ProjectsController,
    MembersController,
    FilesController,
    EntriesController,
    TermsController,
    ExportsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    AuthService,
    EntriesService,
    JobsService,
    ParseService,
    ExportService,
    JobsProcessor,
  ],
})
export class AppModule {}
