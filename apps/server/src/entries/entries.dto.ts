import { BATCH_ACTIONS, BatchAction, STAGES, Stage } from '@gametrans/shared';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import type { EntryFilter } from './entries.service';

export class UpdateEntryDto {
  @IsString() @MaxLength(100_000) translation: string;
  /** 不传时自动推断：有译文 → 已翻译，清空 → 未翻译 */
  @IsOptional() @IsIn(STAGES as unknown as string[]) stage?: Stage;
  /** 词条当前的 version（乐观锁） */
  @IsInt() version: number;
}

export class BatchDto {
  @IsIn(BATCH_ACTIONS as unknown as string[]) action: BatchAction;
  /** 指定词条；与 filter 二选一 */
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
  /** 筛选条件，字段同词条列表的查询参数 */
  @IsOptional() @IsObject() filter?: EntryFilter;
}

export class ReplaceDto {
  /** 查找内容 */
  @IsString() @MinLength(1) @MaxLength(500) find: string;
  /** 替换为，可以为空（即删除） */
  @IsString() @MaxLength(5000) replace: string;
  /** find 为正则表达式，replace 中可用 $1 等引用分组 */
  @IsOptional() @IsBoolean() regex?: boolean;
  @IsOptional() @IsBoolean() caseSensitive?: boolean;
  /** 范围：筛选条件，字段同词条列表；不填表示整个项目（含已隐藏） */
  @IsOptional() @IsObject() filter?: EntryFilter;
  /** 只预览不写入 */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

export class RollbackDto {
  @IsString() historyId: string;
  @IsInt() version: number;
}

export class PropagateDto {
  /** 是否也覆盖已有不同译文的词条 */
  @IsOptional() @IsBoolean() overwrite?: boolean;
}

export class FillDto {
  /** 只填充该文件；不填表示整个项目 */
  @IsOptional() @IsString() fileId?: string;
}

export class BulkSaveItemDto {
  @IsString() @MaxLength(64) id: string;
  /** 词条当前的 version（乐观锁） */
  @IsInt() version: number;
  @IsString() @MaxLength(100_000) translation: string;
  /** 不传时自动推断，规则同单条保存 */
  @IsOptional() @IsIn(STAGES as unknown as string[]) stage?: Stage;
  /** 说明，写入修改历史；严格模式下附带说明可保存缺少控制符的译文 */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class BulkSaveDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BulkSaveItemDto) items: BulkSaveItemDto[];
  /** 严格模式：译文漏掉控制符 / 占位符 / 标签且没有说明的词条不写入 */
  @IsOptional() @IsBoolean() strict?: boolean;
}

export class TmLookupDto {
  /** 要查询的原文，最多 500 条 */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(100_000, { each: true }) texts: string[];
  /** 是否包含「有疑问」的译文，默认只返回已翻译、已审核、已锁定 */
  @IsOptional() @IsBoolean() includeQuestioned?: boolean;
}
