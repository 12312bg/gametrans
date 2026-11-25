import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional } from 'class-validator';
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
  /** 文字参数中的分隔符，如 ["///", "|"]：拆成多条词条，写回时用原分隔符拼接 */
  @ApiProperty({ type: [String], required: false })
  split?: string[];
}

export class SaveTwineRulesDto {
  /** 项目自定义规则，整体替换；与内置规则同名时覆盖内置规则 */
  @ApiProperty({ type: [TwineMacroRuleDto] })
  @IsArray()
  @ArrayMaxSize(MAX_TWINE_RULES)
  macros: TwineMacroRuleDto[];

  /** 确认不需要翻译的自定义宏名：分析时不再提示 */
  @ApiProperty({ type: [String], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  ignored?: string[];
}
