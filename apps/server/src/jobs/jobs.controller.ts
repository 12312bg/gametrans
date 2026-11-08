import { Controller, Get, Param, Query } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { JobModel } from '../common/api.models';
import { AuthUser, CurrentUser } from '../common/decorators';
import { fail } from '../common/errors';
import { JobsService } from './jobs.service';

@ApiTags('文件与任务')
@Controller('projects/:pid/jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly access: AccessService,
  ) {}

  @ApiOperation({ summary: '最近的任务' })
  @ApiQuery({ name: 'type', required: false, enum: ['PARSE', 'EXPORT'] })
  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Query('type') type?: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.jobs.list(pid, type);
  }

  @ApiOperation({ summary: '任务状态', description: '用于轮询解析 / 导出进度；`error` 与 `result` 中的 `code` 对应文档中的提示码。' })
  @ApiOkResponse({ type: JobModel })
  @Get(':jid')
  async get(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('jid') jid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const job = await this.jobs.get(pid, jid);
    if (!job) throw fail('JOB_NOT_FOUND');
    return job;
  }
}
