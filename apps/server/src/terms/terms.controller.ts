import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { ImportTermsDto, TermDto, UpdateTermDto } from './terms.dto';
import { TermsService } from './terms.service';

@ApiTags('术语表')
@Controller('projects/:pid/terms')
export class TermsController {
  constructor(
    private readonly terms: TermsService,
    private readonly access: AccessService,
  ) {}

  private manage(user: AuthUser, pid: string) {
    return this.access.require(user, pid, PERMISSIONS.MANAGE_TERMS);
  }

  @ApiOperation({ summary: '术语列表' })
  @Public()
  @Get()
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.terms.list(pid);
  }

  @ApiOperation({ summary: '添加术语', description: '需要审核员及以上。' })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: TermDto) {
    await this.manage(user, pid);
    return this.terms.create(pid, user.id, dto);
  }

  @ApiOperation({ summary: '修改术语' })
  @Patch(':tid')
  async update(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('tid') tid: string, @Body() dto: UpdateTermDto) {
    await this.manage(user, pid);
    return this.terms.update(pid, tid, dto);
  }

  @ApiOperation({ summary: '删除术语' })
  @Delete(':tid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('tid') tid: string) {
    await this.manage(user, pid);
    await this.terms.remove(pid, tid);
    return { ok: true };
  }

  @ApiOperation({ summary: '批量导入术语', description: '每行「术语,译法[,备注]」，也支持 Tab 分隔。' })
  @Post('import')
  async import(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: ImportTermsDto) {
    await this.manage(user, pid);
    return this.terms.import(pid, user.id, dto.text, dto.overwrite);
  }
}
