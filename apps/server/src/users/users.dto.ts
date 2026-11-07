import { LOCALES, Locale } from '@gametrans/shared';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() @Length(1, 32, { message: 'validation.displayNameLength' }) displayName?: string;
  @IsOptional() @IsString() @Length(0, 500) bio?: string;
  @IsOptional() @IsEmail({}, { message: 'validation.email' }) email?: string;
  /** 界面语言 */
  @IsOptional() @IsIn(LOCALES as unknown as string[], { message: 'validation.locale' }) locale?: Locale;
}

export class ChangePasswordDto {
  @IsString() oldPassword: string;
  @IsString() @Length(8, 72, { message: 'validation.passwordLength' }) newPassword: string;
}

export class AdminUpdateUserDto {
  @IsOptional() @IsBoolean() isSuperAdmin?: boolean;
  @IsOptional() @IsBoolean() isBanned?: boolean;
}

export class ResetPasswordDto {
  @IsString() @Length(8, 72, { message: 'validation.passwordLength' }) password: string;
}
