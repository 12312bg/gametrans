import { STAGES } from '@gametrans/shared';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

/** 可写入导出包的状态（未翻译、已隐藏保持原文） */
export const EXPORTABLE_STAGES = STAGES.filter((s) => s !== 'UNTRANSLATED' && s !== 'HIDDEN') as string[];

export class CreateExportDto {
  /** 文件范围，不填表示全部文件 */
  @IsOptional() @IsArray() @IsString({ each: true }) fileIds?: string[];
  /** 写入哪些状态的译文 */
  @IsArray() @ArrayNotEmpty({ message: 'validation.exportStages' }) @IsIn(EXPORTABLE_STAGES, { each: true }) stages: string[];
  /** 附带 ParaTranz 兼容的译文 JSON */
  @IsOptional() @IsBoolean() includeJson?: boolean;
}
