import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
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

  @ApiOperation({
    summary: '保存宏规则',
    description: '整体替换项目自定义规则与「不翻译」的宏名单（`ignored`，分析时不再提示）。需要管理员及以上。保存后需「重新提取」才会生效。',
  })
  @Put('rules')
  async saveRules(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: SaveTwineRulesDto) {
    return this.twine.saveRules(await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT), dto);
  }

  @ApiOperation({
    summary: '预览宏规则',
    description: '按提交的规则重新提取（不保存），返回词条总数、与当前规则相比新增 / 移除的词条数，以及每个宏会提取的词条数与示例（`perMacro`）。',
  })
  @HttpCode(200)
  @Post('preview')
  async preview(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: SaveTwineRulesDto) {
    return this.twine.preview(await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT), dto);
  }

  @ApiOperation({
    summary: '分析自定义宏',
    description:
      '统计已上传故事中内置宏以外的宏。用 <<widget>> 或 Macro.add 定义的宏按定义判断每个参数的用途（`verdict`：display 显示文字、logic 逻辑值、stored 存入变量、unknown 无法判断）并给出依据（`evidence`）与分隔符（`split`）；其余只按字符串内容猜测（`confidence: low`）。`suggested` 为推荐的规则，`status` 为 configured / ignored / new，`pending` 列出待确认的宏。',
  })
  @Get('macros')
  async macros(@CurrentUser() user: AuthUser, @Param('pid') pid: string) {
    return this.twine.analyze(await this.access.require(user, pid, PERMISSIONS.MANAGE_PROJECT));
  }
}
