import { DEFAULT_TOKEN_EXPIRY_DAYS, LOCALES, Locale, TOKEN_EXPIRY_DAYS, TOKEN_SCOPES, TokenScope } from '@gametrans/shared';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 32, { message: 'validation.usernameLength' })
  @Matches(/^[A-Za-z0-9_\-.]+$/, { message: 'validation.usernamePattern' })
  username: string;

  @IsEmail({}, { message: 'validation.email' })
  email: string;

  @IsString()
  @Length(8, 72, { message: 'validation.passwordLength' })
  password: string;

  @IsOptional()
  @IsString()
  @Length(0, 32, { message: 'validation.displayNameLength' })
  displayName?: string;

  /** 界面语言，注册时记录到账号 */
  @IsOptional()
  @IsIn(LOCALES as unknown as string[], { message: 'validation.locale' })
  locale?: Locale;
}

export class LoginDto {
  /** 用户名或邮箱 */
  @IsString() @Length(1, 128) login: string;
  @IsString() @Length(1, 72) password: string;
}

export class CreateTokenDto {
  /** 令牌名称，便于辨认用途，如「机翻脚本」 */
  @IsString() @Length(1, 60, { message: 'validation.tokenName' }) name: string;
  /** READ：只读（仅 GET 请求）；WRITE：读写（本人角色允许的全部操作） */
  @IsIn(TOKEN_SCOPES as unknown as string[], { message: 'validation.tokenScope' }) scope: TokenScope;
  /** 有效期（天）：7 / 30 / 90 / 365，默认 90 */
  @IsOptional() @IsIn(TOKEN_EXPIRY_DAYS as unknown as number[], { message: 'validation.tokenExpiry' }) expiresInDays?: number = DEFAULT_TOKEN_EXPIRY_DAYS;
  /** 限定只能访问的项目 ID；不填表示本人参与的全部项目 */
  @IsOptional() @IsString() projectId?: string;
}
