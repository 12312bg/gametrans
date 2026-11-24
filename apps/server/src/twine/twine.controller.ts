import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { SaveTwineRulesDto } from './twine.dto';
import { TwineService } from './twine.service';

@ApiTags('Twine')
@Controller('projects/:pid/twine')
export class TwineController {
  constructor(
    private readonly twine: TwineService,
    private readonly access: AccessService,
  ) {}

  @ApiOperation({
    summary: '宏规则',
    description: '`builtin` 为内置的 SugarCube 规则，`macros` 为项目自定义规则（同名覆盖内置）。每条规则说明宏的第几个参数是要翻译的显示文字、第几个参数是说话人。仅 Twine 项目。',
  })
  @Get('rules')
  async rules(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    return this.twine.rules(await this.access.require(user, pid, PERMISSIONS.VIEW));
  }

  @ApiOperation({ summary: '保存宏规则', description: '整体替换项目自定义规则。需要管理员及以上。保存后需「重新提取」才会生效。' })
  @Put('rules')
  async saveRules(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: SaveTwineRulesDto) {
    return this.twine.saveRules(await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT), dto);
  }

  @ApiOperation({
    summary: '分析自定义宏',
    description: '统计已上传故事中内置宏以外的宏：使用次数、各参数位置的字符串数与示例，以及推荐的规则（`suggested`，不像显示文字时为 null）。',
  })
  @Get('macros')
  async macros(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    return this.twine.analyze(await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT));
  }
}
