import { Body, Controller, Delete, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiCreatedResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessService } from '../common/access.service';
import { JobModel } from '../common/api.models';
import { AuthUser, CurrentUser } from '../common/decorators';
import { fail } from '../common/errors';
import { attachment } from '../common/http';
import { StorageService } from '../common/storage.service';
import type { ExportResult } from '../jobs/export.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExportDto } from './exports.dto';

@ApiTags('导出')
@Controller('projects/:pid/exports')
export class ExportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  @ApiOperation({ summary: '生成导出包', description: '异步任务，完成后通过下载接口获取 zip。需要管理员及以上。' })
  @ApiCreatedResponse({ type: JobModel })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: CreateExportDto) {
    await this.access.require(user, pid, PERMISSIONS.CREATE_EXPORT);
    return this.jobs.enqueue(pid, 'EXPORT', { fileIds: dto.fileIds, stages: dto.stages, includeJson: !!dto.includeJson, includeAttachments: dto.includeAttachments !== false }, user.id);
  }

  @ApiOperation({ summary: '导出记录' })
  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.DOWNLOAD_EXPORT);
    return this.jobs.list(pid, 'EXPORT');
  }

  @ApiOperation({ summary: '下载导出包', description: 'zip 内保留游戏目录结构，所有成员可下载。' })
  @ApiProduces('application/zip')
  @Get(':jid/download')
  async download(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('jid') jid: string, @Res({ passthrough: true }) res: Response) {
    await this.access.require(user, pid, PERMISSIONS.DOWNLOAD_EXPORT);
    const job = await this.prisma.job.findFirst({ where: { id: jid, projectId: pid, type: 'EXPORT', status: 'SUCCEEDED' } });
    const result = job?.result as unknown as ExportResult | undefined;
    if (!result?.storageKey || !(await this.storage.exists(result.storageKey))) throw fail('EXPORT_NOT_FOUND');
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': attachment(result.fileName), 'Content-Length': String(result.size) });
    return new StreamableFile(this.storage.stream(result.storageKey));
  }

  @ApiOperation({ summary: '删除导出记录' })
  @Delete(':jid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('jid') jid: string) {
    await this.access.require(user, pid, PERMISSIONS.CREATE_EXPORT);
    const job = await this.prisma.job.findFirst({ where: { id: jid, projectId: pid, type: 'EXPORT' } });
    if (!job) throw fail('EXPORT_NOT_FOUND');
    const result = job.result as unknown as ExportResult | null;
    if (result?.storageKey) await this.storage.remove(result.storageKey);
    await this.prisma.job.delete({ where: { id: jid } });
    return { ok: true };
  }
}
