import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { ApiPaging, ProjectDetailModel, ProjectModel } from '../common/api.models';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { T, Translator } from '../common/locale';
import { CreateProjectDto, TransferDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('项目')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly access: AccessService,
  ) {}

  @ApiOperation({ summary: '项目列表', description: 'scope=public 公开项目（无需登录）；mine 我参与的；all 全部（仅超级管理员）。' })
  @ApiQuery({ name: 'scope', required: false, enum: ['public', 'mine', 'all'] })
  @ApiQuery({ name: 'q', required: false, description: '按名称 / 简介搜索' })
  @ApiQuery({ name: 'engine', required: false, enum: ['RMXP', 'RMVX', 'RMVXACE', 'RMMV', 'RMMZ'] })
  @ApiPaging()
  @Public()
  @Get()
  list(@CurrentUser() user: AuthUser | undefined, @Query() q: Record<string, string>) {
    return this.projects.list(user, q);
  }

  @ApiOperation({ summary: '创建项目', description: '创建者成为所有者。' })
  @ApiCreatedResponse({ type: ProjectModel })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @ApiOperation({ summary: '项目详情', description: '包含当前用户的角色、权限点与词条统计。公开项目无需登录。' })
  @ApiOkResponse({ type: ProjectDetailModel })
  @Public()
  @Get(':pid')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    return this.projects.detail(await this.access.context(user, pid));
  }

  @ApiOperation({ summary: '修改项目设置', description: '需要管理员及以上。' })
  @ApiOkResponse({ type: ProjectModel })
  @Patch(':pid')
  async update(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT), dto);
  }

  @ApiOperation({ summary: '删除项目', description: '仅所有者。删除全部文件、词条与历史，无法恢复。' })
  @Delete(':pid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.DELETE_PROJECT);
    await this.projects.remove(pid);
    return { ok: true };
  }

  @ApiOperation({ summary: '转让项目', description: '仅所有者。原所有者变为管理员。' })
  @Post(':pid/transfer')
  async transfer(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: TransferDto) {
    await this.projects.transfer(await this.access.require(user, pid, PERMISSIONS.DELETE_PROJECT), dto.userId);
    return { ok: true };
  }

  @ApiOperation({ summary: '项目统计', description: '按状态、分类统计，以及翻译 / 审核贡献榜。' })
  @Public()
  @Get(':pid/stats')
  async stats(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.projects.stats(pid);
  }

  @ApiOperation({ summary: '项目动态', description: '`message` 按请求语言渲染，`type` + `params` 可供客户端自行渲染。' })
  @ApiPaging()
  @Public()
  @Get(':pid/activity')
  async activity(
    @CurrentUser() user: AuthUser | undefined,
    @T() t: Translator,
    @Param('pid') pid: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.projects.activities(pid, t, page, pageSize);
  }
}
