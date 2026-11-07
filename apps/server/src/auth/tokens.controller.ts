import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { DEFAULT_TOKEN_EXPIRY_DAYS } from '@gametrans/shared';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, SessionOnly } from '../common/decorators';
import { CreateTokenDto } from './auth.dto';
import { TokensService } from './tokens.service';
import { TokenModel, CreatedTokenModel, OkModel } from '../common/api.models';

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
