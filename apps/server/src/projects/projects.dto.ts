import { ENGINES, Engine, LANGUAGE_CODES } from '@gametrans/shared';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

const LANGS = LANGUAGE_CODES as unknown as string[];

export class CreateProjectDto {
  @IsString() @Length(1, 80, { message: 'validation.projectName' }) name: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsIn(ENGINES as unknown as string[], { message: 'validation.engine' }) engine: Engine;
  @IsIn(LANGS, { message: 'validation.sourceLang' }) sourceLang: string;
  @IsIn(LANGS, { message: 'validation.targetLang' }) targetLang: string;
  @IsIn(['PUBLIC', 'PRIVATE']) visibility: 'PUBLIC' | 'PRIVATE';
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @Length(1, 80, { message: 'validation.projectName' }) name?: string;
  @IsOptional() @IsString() @Length(0, 5000) description?: string;
  @IsOptional() @IsIn(LANGS, { message: 'validation.sourceLang' }) sourceLang?: string;
  @IsOptional() @IsIn(LANGS, { message: 'validation.targetLang' }) targetLang?: string;
  @IsOptional() @IsIn(['PUBLIC', 'PRIVATE']) visibility?: 'PUBLIC' | 'PRIVATE';
}

export class TransferDto {
  @IsString() userId: string;
}
