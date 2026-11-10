import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessService } from '../common/access.service';
import { JobModel } from '../common/api.models';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { fail } from '../common/errors';
import { attachment } from '../common/http';
import { StorageService } from '../common/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { PreEditDto } from '../attachments/attachments.dto';
import { FilesService } from './files.service';
import { UploadInterceptor, fixName, parsePaths, tmpKeyOf } from './upload';

const PREVIEW_QUERY = { name: 'preview', required: false, enum: ['true', 'false'], description: '为 true 时只生成变更预览，确认后调用 POST /jobs/{jid}/apply 导入' } as const;
const isPreview = (v?: string) => v === 'true' || v === '1';

const FILES_BODY = {
  schema: {
    type: 'object',
    required: ['files'],
    properties: {
      files: { type: 'array', items: { type: 'string', format: 'binary' } },
      paths: { type: 'string', description: '可选，与 files 一一对应的相对路径 JSON 数组，如 ["Game/Data/Map001.rvdata2"]' },
    },
  },
};

@ApiTags('文件与任务')
@Controller('projects/:pid/files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  /** 先鉴权，失败时删除 multer 已落盘的临时文件 */
  private async guardUpload(user: AuthUser, pid: string, files: Express.Multer.File[], check?: () => Promise<void>) {
    try {
      await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
      await check?.();
    } catch (e) {
      await this.files.discard(files);
      throw e;
    }
  }

  @ApiOperation({ summary: '文件列表', description: '含每个文件的词条状态统计。' })
  @Public()
  @Get()
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.files.list(pid);
  }

  @ApiOperation({
    summary: '上传文件',
    description: '支持多个数据文件、整个游戏目录（配合 paths）或 zip 压缩包（服务端流式解压，只取数据文件）。返回解析任务，需轮询任务状态。',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILES_BODY)
  @ApiQuery(PREVIEW_QUERY)
  @ApiCreatedResponse({ type: JobModel })
  @Post()
  @UseInterceptors(UploadInterceptor())
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('paths') rawPaths?: string,
    @Query('preview') preview?: string,
  ) {
    await this.guardUpload(user, pid, files, async () => {
      if (!files?.length) throw fail('NO_FILES');
    });
    const paths = parsePaths(rawPaths);
    const uploads = files.map((f, i) => ({ tmpKey: tmpKeyOf(f), name: paths[i] ?? fixName(f.originalname) }));
    return this.jobs.enqueue(pid, 'PARSE', { uploads, preview: isPreview(preview) }, user.id);
  }

  @ApiOperation({ summary: '上传新版本（更新原文）', description: '已有译文按键名保留，原文变化的词条标记为「有疑问」。' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['files'], properties: { files: { type: 'string', format: 'binary' } } } })
  @ApiQuery(PREVIEW_QUERY)
  @ApiCreatedResponse({ type: JobModel })
  @Post(':fid/replace')
  @UseInterceptors(UploadInterceptor())
  async replace(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @Param('fid') fid: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Query('preview') preview?: string,
  ) {
    await this.guardUpload(user, pid, files, async () => {
      if (files?.length !== 1) throw fail('SINGLE_FILE_REQUIRED');
      await this.files.get(pid, fid);
    });
    const [f] = files;
    return this.jobs.enqueue(pid, 'PARSE', { uploads: [{ tmpKey: tmpKeyOf(f), name: fixName(f.originalname) }], replaceFileId: fid, preview: isPreview(preview) }, user.id);
  }

  @ApiOperation({
    summary: '重新提取文本',
    description: '用当前的提取规则重新解析项目中已上传的原文件。已有译文按键名保留；新提取的词条（如变量名、脚本字符串）默认隐藏；原文件中已不存在的词条会被删除。返回解析任务。',
  })
  @ApiCreatedResponse({ type: JobModel })
  @Post('reextract')
  async reextract(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.jobs.enqueue(pid, 'PARSE', { uploads: [], reextract: true }, user.id);
  }

  @ApiOperation({ summary: '删除文件', description: '同时删除其词条、译文与历史。' })
  @Delete(':fid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('fid') fid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    await this.files.remove(pid, fid, user.id);
    return { ok: true };
  }

  @ApiOperation({ summary: '下载原文件', description: '需要文件管理权限。`version=edited` 时下载应用预编辑后的内容（不含译文）。' })
  @ApiQuery({ name: 'version', required: false, enum: ['original', 'edited'] })
  @ApiProduces('application/octet-stream')
  @Get(':fid/download')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('pid') pid: string,
    @Param('fid') fid: string,
    @Res({ passthrough: true }) res: Response,
    @Query('version') version?: string,
  ) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    if (version === 'edited') {
      const { file, data } = await this.files.editedBytes(pid, fid);
      res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': attachment(file.path.split('/').pop() ?? 'file') });
      return new StreamableFile(Buffer.from(data));
    }
    const file = await this.files.get(pid, fid);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': attachment(file.path.split('/').pop() ?? 'file') });
    return new StreamableFile(this.storage.stream(file.storageKey));
  }

  @ApiOperation({
    summary: '预编辑内容',
    description: '返回易读格式的原文件与预编辑后的内容（MV/MZ 的 data/*.json 与 js/plugins.js 的 $plugins 数组）。其他格式 `editable` 为 false。',
  })
  @Get(':fid/edit')
  async getEdit(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('fid') fid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.files.getEdit(pid, fid);
  }

  @ApiOperation({
    summary: '保存预编辑',
    description: '提交编辑后的完整 JSON。保存为相对原文件的字段变更，导出时先应用预编辑、再写入译文。不能改动已提取的词条原文或增删事件指令（409 PREEDIT_TOUCHES_ENTRIES）。',
  })
  @Put(':fid/edit')
  async saveEdit(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('fid') fid: string, @Body() dto: PreEditDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.files.saveEdit(pid, fid, dto.content, user.id);
  }

  @ApiOperation({ summary: '撤销预编辑' })
  @Delete(':fid/edit')
  async clearEdit(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('fid') fid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_FILES);
    return this.files.clearEdit(pid, fid, user.id);
  }
}
