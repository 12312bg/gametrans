/**
 * Twine 宏的提取规则：哪个宏的第几个参数是要翻译的显示文字。
 * 内置一份 SugarCube 2 的默认规则；作者自定义的 widget（如 <<say 角色 "台词">>）在项目设置中补充。
 */

/** 宏规则可选的词条分类；不填为自动：有说话人参数时为「对话」，否则为「正文」 */
export const TWINE_RULE_CATEGORIES = ['passage', 'dialogue', 'choice', 'ui'] as const;
export type TwineRuleCategory = (typeof TWINE_RULE_CATEGORIES)[number];

export interface TwineMacroRule {
  /** 宏名（区分大小写，与 SugarCube 一致） */
  name: string;
  /** 要翻译的参数下标（从 0 开始，按空白分隔计数）；'all' 表示全部字符串参数；空数组表示不提取 */
  args: number[] | 'all';
  /** 作为说话人显示的参数下标（可选） */
  speaker?: number;
  /** 词条分类；不填为自动（有说话人时为 dialogue，否则为 passage） */
  category?: TwineRuleCategory;
  /**
   * 文字参数中的分隔符（如 "|"、"///"）：宏定义会按它拆成多句，
   * 提取时拆成多条词条，写回时用原分隔符拼接
   */
  split?: string[];
}

export interface TwineConfig {
  /** 项目自定义规则；与内置规则同名时覆盖内置规则 */
  macros: TwineMacroRule[];
  /** 确认过不需要翻译的自定义宏：分析时不再提示 */
  ignored?: string[];
}

/** 分析结果中参数的用途：显示文字、逻辑值（比较 / 键 / 目标 / 标签名 / 路径）、存入变量、无法判断 */
export const TWINE_ARG_VERDICTS = ['display', 'logic', 'stored', 'unknown'] as const;
export type TwineArgVerdict = (typeof TWINE_ARG_VERDICTS)[number];

/** 判断依据的类型 */
export type TwineEvidenceKind =
  | 'print' // <<print>> / <<=>> 输出
  | 'text' // 直接写在宏定义的正文中
  | 'link' // 作为链接 / 按钮文字
  | 'call' // 传给另一个宏的文字参数
  | 'shown' // 存入变量，变量在别处输出
  | 'compare' // 参与比较
  | 'key' // 作为键：includes()、数组下标等
  | 'target' // 段落名：<<goto>>、链接目标
  | 'markup' // HTML 标签名、属性、CSS 类
  | 'path' // 拼接成文件路径或 ID
  | 'storedKey' // 存入变量，变量在别处按字符串查找
  | 'store' // 存入变量
  | 'script'; // 只在 JavaScript 中使用（Macro.add 等），无法判断

export interface TwineEvidence {
  kind: TwineEvidenceKind;
  /** 宏定义中的代码片段 */
  code: string;
  /** 经由哪个宏（传参时） */
  via?: string;
}

/** 自定义宏每个参数位置的统计与用途判断 */
export interface TwineArgStat {
  i: number;
  /** 该位置是字符串的次数 */
  strings: number;
  /** 像是句子的次数 */
  prose: number;
  /** 不同取值数（非字符串，判断是否为说话人代号） */
  distinct: number;
  samples: string[];
  verdict: TwineArgVerdict;
  evidence: TwineEvidence[];
  /** 宏定义按这些分隔符拆分该参数 */
  split?: string[];
  /** 是否推荐翻译 */
  recommend: boolean;
}

export interface TwineMacroStat {
  name: string;
  uses: number;
  /** widget：在故事中用 <<widget>> 定义（可分析用法）；script：在 JavaScript 中用 Macro.add 定义；none：找不到定义 */
  source: 'widget' | 'script' | 'none';
  args: TwineArgStat[];
  /** 推荐的规则；没有像显示文字的参数时为 null */
  suggested: TwineMacroRule | null;
  /** high：按宏定义判断；low：只按字符串内容猜测，需要确认 */
  confidence: 'high' | 'low';
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
  // 旧版本保存的 system 分类按 ui 处理
  for (const r of config?.macros ?? []) rules.set(r.name, (r.category as string) === 'system' ? { ...r, category: 'ui' } : r);
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
    // 旧版本的 system 分类改名为 ui
    const category = (r!.category as string) === 'system' ? 'ui' : r!.category;
    if (category !== undefined && category !== null && !TWINE_RULE_CATEGORIES.includes(category)) return { ok: false, error: 'validation.twineRules' };
    let split: string[] | undefined;
    if (r!.split !== undefined && r!.split !== null) {
      if (!Array.isArray(r!.split) || r!.split.length > 8 || !r!.split.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 8)) {
        return { ok: false, error: 'validation.twineRules' };
      }
      split = [...new Set(r!.split as string[])];
    }
    out.push({
      name,
      args,
      ...(isIndex(r!.speaker) ? { speaker: r!.speaker as number } : {}),
      ...(category ? { category } : {}),
      ...(split?.length ? { split } : {}),
    });
  }
  const rawIgnored = (input as { ignored?: unknown }).ignored;
  let ignored: string[] = [];
  if (rawIgnored !== undefined && rawIgnored !== null) {
    if (!Array.isArray(rawIgnored) || rawIgnored.length > 500) return { ok: false, error: 'validation.twineRules' };
    if (!rawIgnored.every((x) => typeof x === 'string' && /^(?:[A-Za-z][\w-]*|[=-])$/.test(x) && x.length <= 64)) return { ok: false, error: 'validation.twineRules' };
    // 已有规则的宏不算「不翻译」
    ignored = [...new Set(rawIgnored as string[])].filter((x) => !seen.has(x)).sort();
  }
  return { ok: true, value: { macros: out, ...(ignored.length ? { ignored } : {}) } };
}
