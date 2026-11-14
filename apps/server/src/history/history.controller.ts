import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { HISTORY_TYPES, PERMISSIONS } from '@gametrans/shared';
import { AccessService } from '../common/access.service';
import { ApiPaging } from '../common/api.models';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { HistoryService } from './history.service';

@ApiTags('历史记录')
@Controller('projects/:pid/history')
export class HistoryController {
  constructor(
    private readonly history: HistoryService,
    private readonly access: AccessService,
  ) {}

  @ApiOperation({
    summary: '项目历史记录',
    description:
      '词条与术语的修改记录，按时间倒序；同一次批量操作合并为一条（`kind` 为 `entry-batch` / `term-batch`，带总数 `count` 与前几条预览 `samples`）。词条记录带有上一版本的译文与状态（`prevTranslation` / `prevStage`，首条记录为 null）用于对比；原文变更记录带有 `oldOriginal` / `newOriginal`。公开项目无需登录。',
  })
  @ApiPaging()
  @ApiQuery({ name: 'type', required: false, enum: HISTORY_TYPES, description: '不传为全部' })
  @ApiQuery({ name: 'userId', required: false })
  @Public()
  @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Param('pid') pid: string,
    @Query('type') type?: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.history.list(pid, { type, userId, page, pageSize });
  }

  @ApiOperation({ summary: '批量操作的全部记录', description: '列表中 `kind` 为 `entry-batch` / `term-batch` 的一组记录，按时间顺序分页返回。' })
  @ApiPaging()
  @Public()
  @Get('batches/:batchId')
  async batch(
    @CurrentUser() user: AuthUser | undefined,
    @Param('pid') pid: string,
    @Param('batchId') batchId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.history.batch(pid, batchId, { page, pageSize });
  }
}
