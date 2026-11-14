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
      '词条与术语的修改记录，按时间倒序。词条记录带有上一版本的译文与状态（`prevTranslation` / `prevStage`，首条记录为 null）用于对比；原文变更记录带有 `oldOriginal` / `newOriginal`。公开项目无需登录。',
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
}
