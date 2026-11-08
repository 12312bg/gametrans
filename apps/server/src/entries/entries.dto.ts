import { BATCH_ACTIONS, BatchAction, STAGES, Stage } from '@gametrans/shared';
import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
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

export class RollbackDto {
  @IsString() historyId: string;
  @IsInt() version: number;
}

export class FillDto {
  /** 只填充该文件；不填表示整个项目 */
  @IsOptional() @IsString() fileId?: string;
}
