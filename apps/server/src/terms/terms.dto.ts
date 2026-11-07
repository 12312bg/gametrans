import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class TermDto {
  @IsString() @Length(1, 200, { message: 'validation.termLength' }) term: string;
  @IsString() @Length(1, 500, { message: 'validation.termTranslationLength' }) translation: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() caseSensitive?: boolean;
}

export class UpdateTermDto {
  @IsOptional() @IsString() @Length(1, 200, { message: 'validation.termLength' }) term?: string;
  @IsOptional() @IsString() @Length(1, 500, { message: 'validation.termTranslationLength' }) translation?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() caseSensitive?: boolean;
}

export class ImportTermsDto {
  /** 每行「术语<Tab 或逗号>译法[<Tab 或逗号>备注]」，# 开头的行忽略 */
  @IsString() @MaxLength(2_000_000) text: string;
  /** 已存在的术语是否用导入的译法覆盖 */
  @IsOptional() @IsBoolean() overwrite?: boolean;
}
