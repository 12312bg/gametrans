import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class RenameAttachmentDto {
  /** 新路径（相对游戏根目录），如 www/img/Quests.txt */
  @IsString() @MaxLength(255) path: string;
}

export class DeleteAttachmentsDto {
  @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) ids: string[];
}

export class PreEditDto {
  /** 预编辑后的完整文本 */
  @IsString() @MaxLength(6 * 1024 * 1024) content: string;
}
