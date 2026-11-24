import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray } from 'class-validator';
import { MAX_TWINE_RULES } from '@gametrans/shared';

export class TwineMacroRuleDto {
  /** 宏名，如 say */
  name: string;
  /** 要翻译的参数下标（从 0 开始）；"all" 表示全部字符串参数 */
  @ApiProperty({ oneOf: [{ type: 'array', items: { type: 'integer' } }, { type: 'string', enum: ['all'] }] })
  args: number[] | 'all';
  /** 作为说话人显示的参数下标 */
  speaker?: number;
  @ApiProperty({ enum: ['dialogue', 'choice', 'system'], required: false })
  category?: string;
}

export class SaveTwineRulesDto {
  /** 项目自定义规则，整体替换；与内置规则同名时覆盖内置规则 */
  @ApiProperty({ type: [TwineMacroRuleDto] })
  @IsArray()
  @ArrayMaxSize(MAX_TWINE_RULES)
  macros: TwineMacroRuleDto[];
}
