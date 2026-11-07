import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { BATCH_ACTIONS, BatchAction, PERMISSIONS, STAGES, Stage } from '@gametrans/shared';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiConflictResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { EntriesService, EntryFilter } from './entries.service';
import { EntryModel, PagedEntriesModel } from '../common/api.models';

class UpdateEntryDto {
  @IsString() @MaxLength(100_000) translation: string;
  @IsOptional() @IsIn(STAGES as unknown as string[]) stage?: Stage;
  @IsInt() version: number;
}

class BatchDto {
  @IsIn(BATCH_ACTIONS as unknown as string[]) action: BatchAction;
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
  @IsOptional() @IsObject() filter?: EntryFilter;
}

class RollbackDto {
  @IsString() historyId: string;
  @IsInt() version: number;
}

class FillDto {
  @IsOptional() @IsString() fileId?: string;
}

@ApiTags('词条')
@Controller('projects/:pid')
export class EntriesController {
  constructor(
    private readonly entries: EntriesService,
    private readonly access: AccessService,
  ) {}

  @ApiOperation({ summary: '词条列表 / 搜索', description: '默认不含「已隐藏」词条，按文件与出现顺序排列。公开项目无需登录。' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数' })
  @ApiQuery({ name: 'page', required: false, description: '页码，从 1 开始' })
  @ApiQuery({ name: 'sort', required: false, description: '排序', enum: ['order', 'updated'] })
  @ApiQuery({ name: 'translatorId', required: false, description: '按译者筛选' })
  @ApiQuery({ name: 'field', required: false, description: '搜索字段', enum: ['all', 'original', 'translation', 'key', 'context'] })
  @ApiQuery({ name: 'q', required: false, description: '搜索关键字' })
  @ApiQuery({ name: 'category', required: false, description: '分类，多个用逗号分隔，如 dialogue,choice' })
  @ApiQuery({ name: 'stage', required: false, description: '状态，多个用逗号分隔，如 UNTRANSLATED,QUESTIONED' })
  @ApiQuery({ name: 'fileId', required: false, description: '文件 ID' })
  @ApiOkResponse({ type: PagedEntriesModel })
  @Public()
  @Get('entries')
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Param('pid') pid: string,
    @Query() query: EntryFilter & { page?: string; pageSize?: string },
  ) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const { page, pageSize, ...filter } = query;
    return this.entries.list(pid, filter, page, pageSize);
  }

  @ApiOperation({ summary: '词条详情' })
  @ApiOkResponse({ type: EntryModel })
  @Public()
  @Get('entries/:eid')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.get(pid, eid);
  }

  @ApiOperation({ summary: '前后相邻词条', description: '同一文件中前后各 3 条，用于理解上下文。' })
  @Public()
  @Get('entries/:eid/neighbors')
  async neighbors(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.neighbors(pid, eid);
  }

  @ApiOperation({ summary: '保存译文 / 修改状态', description: '必须带上当前 `version`；若已被他人修改返回 409，响应中的 `current` 为最新词条。不传 `stage` 时自动推断（有译文 → 已翻译）。' })
  @ApiOkResponse({ type: EntryModel })
  @ApiConflictResponse({ description: '版本冲突，响应包含 message 与 current（最新词条）' })
  @Put('entries/:eid')
  async update(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('eid') eid: string, @Body() dto: UpdateEntryDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return this.entries.update(ctx, eid, dto);
  }

  @ApiOperation({ summary: '批量操作', description: '按 ids 或筛选条件（filter，字段同词条列表）批量审核、锁定、隐藏等；不符合条件的词条会被跳过。' })
  @Post('entries/batch')
  async batch(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: BatchDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.batch(ctx, dto.action, dto.ids, dto.filter);
  }

  @ApiOperation({ summary: '修改历史', description: '最近 100 条。' })
  @Public()
  @Get('entries/:eid/history')
  async history(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.history(pid, eid);
  }

  @ApiOperation({ summary: '回滚到历史版本', description: '需要带上当前 `version`。' })
  @ApiOkResponse({ type: EntryModel })
  @Post('entries/:eid/rollback')
  async rollback(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('eid') eid: string, @Body() dto: RollbackDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return this.entries.rollback(ctx, eid, dto.historyId, dto.version);
  }

  @ApiOperation({ summary: '翻译记忆推荐', description: '按原文相似度推荐项目内已有译文。' })
  @Public()
  @Get('entries/:eid/suggestions')
  async suggestions(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.suggestions(pid, eid);
  }

  @ApiOperation({ summary: '翻译记忆批量填充', description: '把原文完全相同的已有译文填入未翻译词条，需要审核员及以上。' })
  @Post('tm/fill')
  async fill(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: FillDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.REVIEW);
    return this.entries.fill(ctx, dto.fileId);
  }
}
