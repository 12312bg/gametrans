/**
 * OpenAPI 文档使用的响应模型（仅用于生成文档与客户端代码，不参与运行时校验）。
 * 文件名以 .models.ts 结尾，由 @nestjs/swagger 的 CLI 插件自动生成属性元数据。
 */
import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiQuery } from '@nestjs/swagger';

export class ErrorModel {
  /** HTTP 状态码 */
  statusCode: number;
  /** 稳定的错误码，如 FORBIDDEN、ENTRY_CONFLICT、FILE_TOO_LARGE，适合程序判断 */
  @ApiProperty({ example: 'FORBIDDEN' })
  code: string;
  /** 按请求语言（Accept-Language → 账号设置 → 简体中文）翻译的提示 */
  @ApiProperty({ example: '没有权限执行此操作' })
  message: string;
  /** 错误参数，如 VALIDATION_FAILED 的 field、FILE_TOO_LARGE 的 limit */
  @ApiProperty({ type: 'object', additionalProperties: true, required: false })
  params?: Record<string, string | number>;
}

export class ContextPartModel {
  /** 文案键，如 ctx.event */
  k: string;
  @ApiProperty({ type: 'object', additionalProperties: true, required: false })
  p?: Record<string, string | number>;
}

export class UserBriefModel {
  id: string;
  username: string;
  displayName: string;
}

export class StageCountsModel {
  UNTRANSLATED: number;
  TRANSLATED: number;
  QUESTIONED: number;
  REVIEWED: number;
  LOCKED: number;
  HIDDEN: number;
}

export class ProjectModel {
  id: string;
  name: string;
  description: string;
  @ApiProperty({ enum: ['RMXP', 'RMVX', 'RMVXACE', 'RMMV', 'RMMZ'] })
  engine: string;
  /** 源语言代码，如 ja */
  sourceLang: string;
  /** 目标语言代码，如 zh-CN */
  targetLang: string;
  @ApiProperty({ enum: ['PUBLIC', 'PRIVATE'] })
  visibility: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectDetailModel extends ProjectModel {
  /** 当前用户在项目中的角色，非成员为 null */
  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'REVIEWER', 'TRANSLATOR', 'VIEWER'], nullable: true })
  myRole: string | null;
  /** 当前用户在该项目拥有的权限点 */
  permissions: string[];
  stats: StageCountsModel;
  memberCount: number;
  fileCount: number;
}

export class FileRefModel {
  /** 相对游戏根目录的路径，如 data/Map001.json */
  path: string;
}

export class EntryModel {
  id: string;
  fileId: string;
  /** 文件内唯一的键，如 events/1/pages/0/list/3 */
  key: string;
  original: string;
  translation: string;
  /** 结构化位置说明；旧数据为 null */
  @ApiProperty({ type: [ContextPartModel], nullable: true })
  contextData: ContextPartModel[] | null;
  /** 按请求语言渲染的位置说明 */
  contextText: string;
  @ApiProperty({
    enum: ['dialogue', 'choice', 'scroll', 'speaker', 'name', 'nickname', 'description', 'message', 'system', 'map', 'note', 'script', 'plugin', 'other'],
  })
  category: string;
  /** 危险文本（脚本 / 插件 / 备注） */
  danger: boolean;
  @ApiProperty({ enum: ['UNTRANSLATED', 'TRANSLATED', 'QUESTIONED', 'REVIEWED', 'LOCKED', 'HIDDEN'] })
  stage: string;
  /** 乐观锁版本号，保存译文时需原样带回 */
  version: number;
  sortOrder: number;
  updatedAt: Date;
  file: FileRefModel;
  @ApiProperty({ type: UserBriefModel, nullable: true })
  translator: UserBriefModel | null;
  @ApiProperty({ type: UserBriefModel, nullable: true })
  reviewer: UserBriefModel | null;
}

export class PagedEntriesModel {
  @ApiProperty({ type: [EntryModel] })
  items: EntryModel[];
  total: number;
  page: number;
  pageSize: number;
}

export class JobModel {
  id: string;
  projectId: string;
  @ApiProperty({ enum: ['PARSE', 'EXPORT'] })
  type: string;
  @ApiProperty({ enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] })
  status: string;
  /** 进度 0-100 */
  progress: number;
  @ApiProperty({ description: '任务结果：解析任务为各文件的新增/变更统计；导出任务包含 fileName、size、applied 等', type: 'object', additionalProperties: true, nullable: true })
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export class TokenProjectModel {
  id: string;
  name: string;
}

export class TokenModel {
  id: string;
  name: string;
  /** 明文前缀，用于辨认 */
  prefix: string;
  @ApiProperty({ enum: ['READ', 'WRITE'] })
  scope: string;
  expiresAt: Date;
  @ApiProperty({ nullable: true })
  lastUsedAt: Date | null;
  createdAt: Date;
  @ApiProperty({ type: TokenProjectModel, nullable: true })
  project: TokenProjectModel | null;
}

export class CreatedTokenModel extends TokenModel {
  /** 令牌明文，只在创建时返回这一次，请妥善保存 */
  @ApiProperty({ example: 'gt_3q2+7w...' })
  token: string;
}

export class OkModel {
  ok: boolean;
}

export class AttachmentModel {
  id: string;
  /** 相对游戏根目录的路径，如 www/img/Quests.txt */
  path: string;
  size: number;
  sha256: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: UserBriefModel | null;
}

export class AttachmentUploadModel {
  /** 新增的附件数 */
  created: number;
  /** 覆盖的同路径附件数 */
  updated: number;
  /** 上传后的全部附件 */
  items: AttachmentModel[];
}

/** 分页参数 page / pageSize 的文档装饰器 */
export const ApiPaging = () =>
  applyDecorators(
    ApiQuery({ name: 'page', required: false, description: '页码，从 1 开始' }),
    ApiQuery({ name: 'pageSize', required: false, description: '每页条数' }),
  );
