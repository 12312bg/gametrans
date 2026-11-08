import { en } from './en';
import { zhCN } from './zh-CN';

export const LOCALES = ['zh-CN', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LOCALE_NAMES: Record<Locale, string> = { 'zh-CN': '简体中文', en: 'English' };

export type MessageKey = keyof typeof zhCN;
export const MESSAGES: Record<Locale, Record<string, string>> = { 'zh-CN': zhCN, en };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** 解析 Accept-Language 等语言标识，返回支持的语言（zh-* 统一为简体中文） */
export function resolveLocale(input?: string | null): Locale | undefined {
  for (const part of (input ?? '').split(',')) {
    const tag = part.split(';')[0].trim().toLowerCase();
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('en')) return 'en';
  }
  return undefined;
}

export function interpolate(text: string, params?: Record<string, unknown>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] === undefined ? m : String(params[k])));
}

export function translate(locale: Locale, key: string, params?: Record<string, unknown>): string {
  const text = MESSAGES[locale]?.[key] ?? MESSAGES[DEFAULT_LOCALE][key];
  return text === undefined ? key : interpolate(text, params);
}

export function hasMessage(key: string): boolean {
  return key in MESSAGES[DEFAULT_LOCALE];
}

export { en, zhCN };
