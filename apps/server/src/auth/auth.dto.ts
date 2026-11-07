import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @Length(3, 32, { message: '用户名长度为 3-32 个字符' })
  @Matches(/^[A-Za-z0-9_\-.]+$/, { message: '用户名只能包含字母、数字、下划线、连字符和点' })
  username: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @Length(8, 72, { message: '密码长度为 8-72 个字符' })
  password: string;

  @IsOptional()
  @IsString()
  @Length(0, 32, { message: '昵称最多 32 个字符' })
  displayName?: string;
}

export class LoginDto {
  @IsString()
  @Length(1, 128)
  login: string;

  @IsString()
  @Length(1, 72)
  password: string;
}
