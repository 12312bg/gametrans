import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { DEFAULT_LOCALE, Locale, MESSAGES, isLocale, resolveLocale } from '@gametrans/shared';
import * as sections from './ui';

const STORAGE_KEY = 'gt-locale';

const merge = (lang: 'zh' | 'en') => Object.assign({}, ...Object.values(sections).map((s) => s[lang])) as Record<string, string>;

export const UI_MESSAGES = { 'zh-CN': merge('zh'), en: merge('en') };

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* 隐私模式下不可用 */
  }
  return resolveLocale(navigator.languages?.join(',') || navigator.language) ?? DEFAULT_LOCALE;
}

const initial = detect();
void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: { ...MESSAGES['zh-CN'], ...UI_MESSAGES['zh-CN'] } },
    en: { translation: { ...MESSAGES.en, ...UI_MESSAGES.en } },
  },
  lng: initial,
  fallbackLng: DEFAULT_LOCALE,
  // 键名本身带点号，关闭层级分隔；插值使用 {name}，与服务端一致
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
});
syncSideEffects(initial);

function syncSideEffects(locale: Locale) {
  document.documentElement.lang = locale;
  dayjs.locale(locale === 'zh-CN' ? 'zh-cn' : 'en');
}

export const currentLocale = (): Locale => (isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE);

export function applyLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  syncSideEffects(locale);
  return i18n.changeLanguage(locale);
}

export type TFn = (key: string, params?: Record<string, unknown>) => string;

/** 组件内取翻译函数；语言切换时自动重新渲染 */
export function useT(): TFn {
  const { t } = useTranslation();
  return t as unknown as TFn;
}

/** 非组件代码中使用 */
export const t: TFn = (key, params) => i18n.t(key, params) as string;

export { i18n };
