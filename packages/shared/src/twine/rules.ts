/**
 * Twine 宏的提取规则：哪个宏的第几个参数是要翻译的显示文字。
 * 内置一份 SugarCube 2 的默认规则；作者自定义的 widget（如 <<say 角色 "台词">>）在项目设置中补充。
 */

export const TWINE_RULE_CATEGORIES = ['dialogue', 'choice', 'system'] as const;
export type TwineRuleCategory = (typeof TWINE_RULE_CATEGORIES)[number];

export interface TwineMacroRule {
  /** 宏名（区分大小写，与 SugarCube 一致） */
  name: string;
  /** 要翻译的参数下标（从 0 开始，按空白分隔计数）；'all' 表示全部字符串参数；空数组表示不提取 */
  args: number[] | 'all';
  /** 作为说话人显示的参数下标（可选） */
  speaker?: number;
  /** 词条分类，默认 dialogue */
  category?: TwineRuleCategory;
}

export interface TwineConfig {
  /** 项目自定义规则；与内置规则同名时覆盖内置规则 */
  macros: TwineMacroRule[];
}

/** 项目的解析配置（Project.parserConfig） */
export interface ParserConfig {
  twine?: TwineConfig;
}

export const MAX_TWINE_RULES = 200;

/** SugarCube 2 内置宏中带显示文字的参数 */
export const DEFAULT_TWINE_MACROS: TwineMacroRule[] = [
  { name: 'link', args: [0], category: 'choice' },
  { name: 'button', args: [0], category: 'choice' },
  { name: 'linkappend', args: [0], category: 'choice' },
  { name: 'linkprepend', args: [0], category: 'choice' },
  { name: 'linkreplace', args: [0], category: 'choice' },
  { name: 'click', args: [0], category: 'choice' },
  { name: 'actions', args: 'all', category: 'choice' },
  { name: 'choice', args: [1], category: 'choice' },
  { name: 'back', args: [0], category: 'choice' },
  { name: 'return', args: [0], category: 'choice' },
  { name: 'option', args: [0], category: 'choice' },
];

/**
 * 参数是 JavaScript 表达式的宏：其中的字符串作为脚本词条提取（默认隐藏）。
 * if / elseif / switch / case 中的字符串多用于比较，不提取。
 */
export const TWINE_SCRIPT_MACROS = new Set(['set', 'run', 'print', '=', '-', 'unset', 'capture']);

/** 只控制流程、不显示文字的内置宏：分析自定义宏时跳过 */
export const TWINE_BUILTIN_MACROS = new Set([
  'if', 'elseif', 'else', 'switch', 'case', 'default', 'for', 'break', 'continue', 'set', 'unset', 'run', 'print', '=', '-',
  'script', 'capture', 'silently', 'nobr', 'include', 'goto', 'widget', 'timed', 'next', 'stop', 'repeat', 'type', 'done',
  'addclass', 'removeclass', 'toggleclass', 'copy', 'append', 'prepend', 'replace', 'remove', 'audio', 'cacheaudio',
  'createaudiogroup', 'createplaylist', 'masteraudio', 'playlist', 'removeaudiogroup', 'removeplaylist', 'waitforaudio',
  'track', 'checkbox', 'cycle', 'listbox', 'optionsfrom', 'radiobutton', 'textarea', 'textbox', 'numberbox', 'do', 'redo',
  'emph', 'linkify', 'remember', 'forget', 'display', 'actions', 'back', 'return', 'choice', 'link', 'button', 'linkappend',
  'linkprepend', 'linkreplace', 'click', 'option',
]);

/** 实际生效的规则：内置规则 + 项目规则（同名覆盖） */
export function effectiveTwineRules(config?: TwineConfig | null): Map<string, TwineMacroRule> {
  const rules = new Map(DEFAULT_TWINE_MACROS.map((r) => [r.name, r]));
  for (const r of config?.macros ?? []) rules.set(r.name, r);
  return rules;
}

/** 规范化并校验用户提交的规则；返回错误说明（i18n 键）或规范化结果 */
export function normalizeTwineConfig(input: unknown): { ok: true; value: TwineConfig } | { ok: false; error: string } {
  const macros = (input as { macros?: unknown } | null)?.macros;
  if (!Array.isArray(macros)) return { ok: false, error: 'validation.twineRules' };
  if (macros.length > MAX_TWINE_RULES) return { ok: false, error: 'validation.twineRules' };
  const seen = new Set<string>();
  const out: TwineMacroRule[] = [];
  for (const raw of macros) {
    const r = raw as Partial<TwineMacroRule> | null;
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    if (!/^(?:[A-Za-z][\w-]*|[=-])$/.test(name) || name.length > 64 || seen.has(name)) return { ok: false, error: 'validation.twineRules' };
    seen.add(name);
    const isIndex = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 32;
    let args: number[] | 'all';
    if (r!.args === 'all') args = 'all';
    else if (Array.isArray(r!.args) && r!.args.every(isIndex)) args = [...new Set(r!.args as number[])].sort((a, b) => a - b);
    else return { ok: false, error: 'validation.twineRules' };
    if (r!.speaker !== undefined && r!.speaker !== null && !isIndex(r!.speaker)) return { ok: false, error: 'validation.twineRules' };
    if (r!.category !== undefined && !TWINE_RULE_CATEGORIES.includes(r!.category)) return { ok: false, error: 'validation.twineRules' };
    out.push({
      name,
      args,
      ...(isIndex(r!.speaker) ? { speaker: r!.speaker as number } : {}),
      ...(r!.category && r!.category !== 'dialogue' ? { category: r!.category } : {}),
    });
  }
  return { ok: true, value: { macros: out } };
}
