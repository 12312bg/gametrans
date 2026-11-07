import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { BATCH_ACTIONS, BatchAction, PERMISSIONS, STAGES, Stage } from '@gametrans/shared';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { EntriesService, EntryFilter } from './entries.service';

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

@Controller('projects/:pid')
export class EntriesController {
  constructor(
    private readonly entries: EntriesService,
    private readonly access: AccessService,
  ) {}

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

  @Public()
  @Get('entries/:eid')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.get(pid, eid);
  }

  @Public()
  @Get('entries/:eid/neighbors')
  async neighbors(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.neighbors(pid, eid);
  }

  @Put('entries/:eid')
  async update(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('eid') eid: string, @Body() dto: UpdateEntryDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return this.entries.update(ctx, eid, dto);
  }

  @Post('entries/batch')
  async batch(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: BatchDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.batch(ctx, dto.action, dto.ids, dto.filter);
  }

  @Public()
  @Get('entries/:eid/history')
  async history(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.history(pid, eid);
  }

  @Post('entries/:eid/rollback')
  async rollback(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('eid') eid: string, @Body() dto: RollbackDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.TRANSLATE);
    return this.entries.rollback(ctx, eid, dto.historyId, dto.version);
  }

  @Public()
  @Get('entries/:eid/suggestions')
  async suggestions(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string, @Param('eid') eid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.entries.suggestions(pid, eid);
  }

  @Post('tm/fill')
  async fill(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: FillDto) {
    const ctx = await this.access.require(user, pid, PERMISSIONS.REVIEW);
    return this.entries.fill(ctx, dto.fileId);
  }
}
