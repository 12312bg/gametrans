import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiConflictResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { T, Translator } from '../common/locale';
import { BatchDto, FillDto, ReplaceDto, RollbackDto, UpdateEntryDto } from './entries.dto';
import { EntriesService, EntryFilter, withContextText } from './entries.service';
import { EntryModel, PagedEntriesModel } from '../common/api.models';

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
    @T() t: Translator,
    @Param('pid') pid: string,
    @Query() query: EntryFilter & { page?: string; pageSize?: string },
  ) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    const { page, pageSize, ...filter } = query;
    const res = await this.entries.list(pid, filter, page, pageSize);
    return { ...res, items: res.items.map((e) => withContextText(e, t)) };
  }

  @ApiOperation({ summary: '词条详情' })
  @ApiOkResponse({ type: EntryModel })
  @Public()
  @Get('entries/:eid')
  async get(@CurrentUser() user: AuthUser | undefined, @T() t: Translator, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return withContextText(await this.entries.get(pid, eid), t);
  }

  @ApiOperation({ summary: '词条在筛选结果中的位置', description: '查询参数同词条列表；返回按默认排序的序号 `index`（从 0 开始），不在结果中时为 null。用于跳转到包含该词条的页。' })
  @Public()
  @Get('entries/:eid/position')
  async position(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string, @Query() query: EntryFilter) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.position(pid, eid, query);
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
  async update(@CurrentUser() user: AuthUser, @T() t: Translator, @Param('pid') pid: string, @Param('eid') eid: string, @Body() dto: UpdateEntryDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return withContextText(await this.entries.update(ctx, eid, dto), t);
  }

  @ApiOperation({ summary: '批量操作', description: '按 ids 或筛选条件（filter，字段同词条列表）批量审核、锁定、隐藏等；不符合条件的词条会被跳过。' })
  @Post('entries/batch')
  async batch(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: BatchDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.batch(ctx, dto.action, dto.ids, dto.filter);
  }

  @ApiOperation({ summary: '相同原文的脚本 / 插件字符串', description: '脚本里赋值和比较的往往是同一个值（如赋值 "Normal" 后在条件分支中判断），这些词条的译文需要保持一致。其他分类返回空数组。' })
  @ApiOkResponse({ type: EntryModel, isArray: true })
  @Public()
  @Get('entries/:eid/linked')
  async linked(@CurrentUser() user: AuthUser | undefined, @T() t: Translator, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return (await this.entries.linked(pid, eid)).map((e) => withContextText(e, t));
  }

  @ApiOperation({ summary: '同步译文到相同的脚本 / 插件字符串', description: '把该词条已保存的译文与状态复制到原文相同的脚本 / 插件字符串；没有权限修改的词条计入 skipped。' })
  @Post('entries/:eid/sync')
  async sync(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('eid') eid: string) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return this.entries.syncLinked(ctx, eid);
  }

  @ApiOperation({
    summary: '批量替换译文',
    description:
      '审核员及以上。只替换当前用户有权修改的词条，状态不变，写入历史可回滚。`dryRun: true` 时只返回预览（前 200 条明细）。未指定 filter 时为整个项目（含已隐藏）。',
  })
  @Post('entries/replace')
  async replace(@CurrentUser() user: AuthUser, @T() t: Translator, @Param('pid') pid: string, @Body() dto: ReplaceDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.REVIEW);
    return this.entries.replace(ctx, dto, t);
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
  async rollback(@CurrentUser() user: AuthUser, @T() t: Translator, @Param('pid') pid: string, @Param('eid') eid: string, @Body() dto: RollbackDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return withContextText(await this.entries.rollback(ctx, eid, dto.historyId, dto.version), t);
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
