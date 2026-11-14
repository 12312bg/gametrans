import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { config } from './config';
import { EntriesModule } from './entries/entries.module';
import { ExportsModule } from './exports/exports.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { FilesModule } from './files/files.module';
import { HistoryModule } from './history/history.module';
import { JobsModule } from './jobs/jobs.module';
import { MembersModule } from './members/members.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { TermsModule } from './terms/terms.module';
import { UsersModule } from './users/users.module';

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
    ...(config.staticDir ? [ServeStaticModule.forRoot({ rootPath: config.staticDir, exclude: ['/api/(.*)'] })] : []),
    RealtimeModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    MembersModule,
    FilesModule,
    AttachmentsModule,
    JobsModule,
    EntriesModule,
    TermsModule,
    HistoryModule,
    ExportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
