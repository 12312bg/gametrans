import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessService } from '../common/access.service';
import { AttachmentModel, AttachmentUploadModel } from '../common/api.models';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { fail } from '../common/errors';
import { attachment } from '../common/http';
import { StorageService } from '../common/storage.service';
import { UploadInterceptor, fixName, parsePaths, tmpKeyOf } from '../files/upload';
import { DeleteAttachmentsDto, PreEditDto, RenameAttachmentDto } from './attachments.dto';
import { AttachmentsService } from './attachments.service';

@ApiTags('附件')
@Controller('projects/:pid/attachments')
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  @ApiOperation({ summary: '附件列表', description: '附件不参与翻译，导出时按路径原样放入导出包。' })
  @ApiOkResponse({ type: AttachmentModel, isArray: true })
  @Public()
  @Get()
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.attachments.list(pid);
  }

  @ApiOperation({
    summary: '上传附件',
    description:
      '上传到 dir 目录（相对游戏根目录，如 www/img；不存在的子目录会自动创建）。数据文件及其所在目录的路径已锁定，附件不能与之同名；同一路径的附件会被覆盖。需要文件管理权限。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        dir: { type: 'string', description: '目标目录，留空为游戏根目录', example: 'www/img' },
        paths: { type: 'string', description: '可选，与 files 一一对应的相对路径 JSON 数组（上传文件夹时保留子目录）' },
        keepEdits: { type: 'string', description: '可选，覆盖同名附件时要保留预编辑的完整路径 JSON 数组；未列出的同名附件预编辑会被丢弃' },
      },
    },
  })
  @ApiOkResponse({ type: AttachmentUploadModel })
  @Post()
  @UseInterceptors(UploadInterceptor())
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('dir') dir?: string,
    @Body('paths') rawPaths?: string,
    @Body('keepEdits') rawKeep?: string,
  ) {
    try {
      await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
      if (!files?.length) throw fail('NO_FILES');
    } catch (e) {
      for (const f of files ?? []) await this.storage.remove(tmpKeyOf(f));
      throw e;
    }
    const paths = parsePaths(rawPaths);
    const uploads = files.map((f, i) => ({ tmpKey: tmpKeyOf(f), size: f.size, name: paths[i] ?? fixName(f.originalname) }));
    return this.attachments.upload(pid, user.id, dir ?? '', uploads, parsePaths(rawKeep).filter((p): p is string => !!p));
  }

  @ApiOperation({ summary: '改名 / 移动附件', description: '新路径同样不能与数据文件或其他附件冲突。' })
  @ApiOkResponse({ type: AttachmentModel })
  @Patch(':aid')
  async rename(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('aid') aid: string, @Body() dto: RenameAttachmentDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.attachments.rename(pid, aid, dto.path, user.id);
  }

  @ApiOperation({ summary: '批量删除附件' })
  @Post('delete')
  async removeMany(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: DeleteAttachmentsDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.attachments.removeMany(pid, dto.ids, user.id);
  }

  @ApiOperation({ summary: '保存预编辑', description: '只支持 UTF-8 文本附件。原件不变，导出时使用预编辑后的内容；保留原件的 BOM 与换行符；内容与原件相同时撤销预编辑。' })
  @ApiOkResponse({ type: AttachmentModel })
  @Put(':aid/edit')
  async saveEdit(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('aid') aid: string, @Body() dto: PreEditDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.attachments.saveEdit(pid, aid, dto.content, user.id);
  }

  @ApiOperation({ summary: '撤销预编辑' })
  @ApiOkResponse({ type: AttachmentModel })
  @Delete(':aid/edit')
  async clearEdit(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('aid') aid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.attachments.clearEdit(pid, aid, user.id);
  }

  @ApiOperation({ summary: '下载附件', description: '需要文件管理权限；其他成员通过导出包获取附件。默认下载导出时使用的版本（有预编辑时为预编辑后的内容）。' })
  @ApiQuery({ name: 'version', required: false, enum: ['original', 'edited'] })
  @ApiProduces('application/octet-stream')
  @Get(':aid/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @Param('aid') aid: string,
    @Res({ passthrough: true }) res: Response,
    @Query('version') version?: string,
  ) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    const { attachment: a, key, size } = await this.attachments.content(pid, aid, version);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': attachment(a.path.split('/').pop() ?? 'file'), 'Content-Length': String(size) });
    return new StreamableFile(this.storage.stream(key));
  }

  @ApiOperation({ summary: '删除附件' })
  @Delete(':aid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('aid') aid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    await this.attachments.remove(pid, aid, user.id);
    return { ok: true };
  }
}
