import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@gametrans/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { fail } from '../common/errors';
import { RealtimeService, rtUser } from './realtime.service';

class FocusDto {
  @IsString()
  @MaxLength(64)
  connId!: string;

  /** 正在编辑的词条，离开编辑器时为空 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entryId?: string | null;
}

/** 每隔这么久重新检查一次访问权限（被移出私有项目、项目改为私有等） */
const RECHECK_MS = 60_000;

@ApiTags('实时推送')
@Controller('projects/:pid')
export class RealtimeController {
  constructor(
    private readonly rt: RealtimeService,
    private readonly access: AccessService,
  ) {}

  @ApiOperation({
    summary: '项目事件流（SSE）',
    description:
      '`text/event-stream`，每条 `data:` 为一个 JSON 事件：`hello`（连接 ID）、`entry`（单条词条变化）、`entries`（批量变化，需重新加载）、`terms`、`files`、`presence`（在线成员与正在编辑的词条）。公开项目无需登录。',
  })
  @Public()
  @Get('events')
  async events(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Res() res: Response) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const timer = setInterval(() => {
      this.access.require(user, pid, PERMISSIONS.VIEW).catch(() => res.end());
    }, RECHECK_MS);
    timer.unref();
    await this.rt.open(pid, rtUser(user), res, () => clearInterval(timer));
  }

  @ApiOperation({ summary: '上报正在编辑的词条', description: '`connId` 来自事件流的 `hello` 事件。' })
  @Post('presence')
  async focus(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: FocusDto) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    if (!(await this.rt.focus(pid, user.id, dto.connId, dto.entryId ?? null))) throw fail('NOT_FOUND');
    return { ok: true };
  }
}
