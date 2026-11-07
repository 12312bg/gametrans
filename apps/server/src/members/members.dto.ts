import { PROJECT_ROLES, ProjectRole } from '@gametrans/shared';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/** 所有者只能通过转让产生 */
const ASSIGNABLE = PROJECT_ROLES.filter((r) => r !== 'OWNER') as string[];

export class RoleDto {
  @IsIn(ASSIGNABLE, { message: 'validation.role' }) role: ProjectRole;
}

export class JoinRequestDto {
  @IsOptional() @IsString() @Length(0, 500) message?: string;
}

export class ApproveDto {
  /** 默认翻译员 */
  @IsOptional() @IsIn(ASSIGNABLE, { message: 'validation.role' }) role?: ProjectRole;
}

export class InviteDto {
  /** 用户名或邮箱 */
  @IsString() @Length(1, 128) username: string;
  @IsIn(ASSIGNABLE, { message: 'validation.role' }) role: ProjectRole;
}
