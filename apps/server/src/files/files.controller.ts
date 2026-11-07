import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PERMISSIONS, Stage } from '@gametrans/shared';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AccessService } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { StorageService } from '../common/storage.service';
import { config } from '../config';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { emptyCounts } from '../projects/projects.controller';

const uploadInterceptor = FilesInterceptor('files', 5000, {
  storage: diskStorage({
    destination: join(config.storageDir, 'tmp'),
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: config.uploadLimitMb * 1024 * 1024 },
});

/** multer 按 latin1 解析文件名，转回 UTF-8 */
function fixName(name: string): string {
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

function parsePaths(raw: unknown, count: number): (string | undefined)[] {
  if (typeof raw !== 'string' || !raw) return new Array(count).fill(undefined);
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((x) => (typeof x === 'string' && x ? x : undefined)) : [];
  } catch {
    return [];
  }
}

@Controller('projects/:pid')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly activity: ActivityService,
  ) {}

  @Public()
  @Get('files')
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const [files, counts] = await Promise.all([
      this.prisma.file.findMany({ where: { projectId: pid }, orderBy: { path: 'asc' } }),
      this.prisma.entry.groupBy({ by: ['fileId', 'stage'], where: { projectId: pid }, _count: { _all: true } }),
    ]);
    const byFile = new Map<string, Record<Stage, number>>();
    for (const c of counts) {
      const m = byFile.get(c.fileId) ?? emptyCounts();
      m[c.stage as Stage] = c._count._all;
      byFile.set(c.fileId, m);
    }
    return files.map(({ storageKey: _k, ...f }) => ({ ...f, stats: byFile.get(f.id) ?? emptyCounts() }));
  }

  /** 上传文件 / 文件夹 / zip 压缩包，异步解析 */
  @Post('files')
  @UseInterceptors(uploadInterceptor)
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('paths') rawPaths?: string,
  ) {
    try {
      await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    } catch (e) {
      for (const f of files ?? []) await this.storage.remove(`tmp/${f.filename}`);
      throw e;
    }
    if (!files?.length) throw new BadRequestException('请选择要上传的文件');
    const paths = parsePaths(rawPaths, files.length);
    const uploads = files.map((f, i) => ({ tmpKey: `tmp/${f.filename}`, name: paths[i] ?? fixName(f.originalname) }));
    return this.jobs.enqueue(pid, 'PARSE', { uploads }, user.id);
  }

  /** 用新版本替换文件（更新原文，已有译文按键合并保留） */
  @Post('files/:fid/replace')
  @UseInterceptors(uploadInterceptor)
  async replace(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @Param('fid') fid: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    try {
      await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
      if (files?.length !== 1) throw new BadRequestException('请选择一个文件');
      const file = await this.prisma.file.findFirst({ where: { id: fid, projectId: pid } });
      if (!file) throw new NotFoundException('文件不存在');
    } catch (e) {
      for (const f of files ?? []) await this.storage.remove(`tmp/${f.filename}`);
      throw e;
    }
    const f = files[0];
    return this.jobs.enqueue(
      pid,
      'PARSE',
      { uploads: [{ tmpKey: `tmp/${f.filename}`, name: fixName(f.originalname) }], replaceFileId: fid },
      user.id,
    );
  }

  @Delete('files/:fid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('fid') fid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    const file = await this.prisma.file.findFirst({ where: { id: fid, projectId: pid } });
    if (!file) throw new NotFoundException('文件不存在');
    await this.prisma.file.delete({ where: { id: fid } });
    const stillUsed = await this.prisma.file.count({ where: { storageKey: file.storageKey } });
    if (!stillUsed) await this.storage.remove(file.storageKey);
    await this.activity.log(pid, user.id, 'file.delete', `删除了文件 ${file.path}`);
    return { ok: true };
  }

  @Get('files/:fid/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @Param('fid') fid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    const file = await this.prisma.file.findFirst({ where: { id: fid, projectId: pid } });
    if (!file) throw new NotFoundException('文件不存在');
    const name = file.path.split('/').pop() ?? 'file';
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    return new StreamableFile(this.storage.stream(file.storageKey));
  }

  // ───────── 任务 ─────────

  @Get('jobs')
  async jobsList(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Query('type') type?: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.prisma.job.findMany({
      where: { projectId: pid, ...(type === 'PARSE' || type === 'EXPORT' ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        result: true,
        error: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        createdBy: { select: { id: true, username: true, displayName: true } },
      },
    });
  }

  @Get('jobs/:jid')
  async jobGet(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('jid') jid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const job = await this.prisma.job.findFirst({
      where: { id: jid, projectId: pid },
      select: { id: true, type: true, status: true, progress: true, result: true, error: true, createdAt: true, finishedAt: true },
    });
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }
}
