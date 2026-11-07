import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DEFAULT_TOKEN_EXPIRY_DAYS, TOKEN_EXPIRY_DAYS, TOKEN_SCOPES, TokenScope } from '@gametrans/shared';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, SessionOnly } from '../common/decorators';
import { TokensService } from './tokens.service';
import { TokenModel, CreatedTokenModel, OkModel } from '../common/api.models';

export class CreateTokenDto {
  /** 令牌名称，便于辨认用途，如「机翻脚本」 */
  @IsString() @Length(1, 60, { message: '名称为 1-60 个字符' }) name: string;
  /** READ：只读（仅 GET 请求）；WRITE：读写（本人角色允许的全部操作） */
  @IsIn(TOKEN_SCOPES as unknown as string[], { message: '权限范围只能是 READ 或 WRITE' }) scope: TokenScope;
  /** 有效期（天）：7 / 30 / 90 / 365，默认 90 */
  @IsOptional() @IsIn(TOKEN_EXPIRY_DAYS as unknown as number[], { message: '有效期只能是 7、30、90 或 365 天' }) expiresInDays?: number;
  /** 限定只能访问的项目 ID；不填表示本人参与的全部项目 */
  @IsOptional() @IsString() projectId?: string;
}

/** 个人 API 令牌管理：只能在网页登录后操作，令牌本身不能用来管理令牌 */
@SessionOnly()
@ApiTags('API 令牌')
@Controller('users/me/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @ApiOperation({ summary: '我的 API 令牌', description: '仅限网页登录调用。' })
  @ApiOkResponse({ type: [TokenModel] })
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tokens.list(user.id);
  }

  @ApiOperation({ summary: '创建 API 令牌', description: '仅限网页登录调用。响应中的 `token` 为明文，只返回这一次。' })
  @ApiCreatedResponse({ type: CreatedTokenModel })
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTokenDto) {
    return this.tokens.create(user.id, { ...dto, expiresInDays: dto.expiresInDays ?? DEFAULT_TOKEN_EXPIRY_DAYS });
  }

  @ApiOperation({ summary: '撤销 API 令牌', description: '仅限网页登录调用，撤销后立即失效。' })
  @ApiOkResponse({ type: OkModel })
  @Delete(':id')
  @HttpCode(200)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.tokens.remove(user.id, id);
    return { ok: true };
  }
}
