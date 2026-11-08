import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Mode = 'light' | 'dark';

const ThemeContext = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => undefined });

export const BRAND = '#6366f1';

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem('gt-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem('gt-theme', mode);
    } catch {
      /* ignore */
    }
  }, [mode]);
  const value = useMemo(() => ({ mode, toggle: () => setMode((m) => (m === 'light' ? 'dark' : 'light')) }), [mode]);
  const dark = mode === 'dark';
  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        locale={i18n.language === 'en' ? enUS : zhCN}
        theme={{
          algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: {
            colorPrimary: BRAND,
            colorInfo: BRAND,
            borderRadius: 8,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans JP", sans-serif',
            colorBgLayout: dark ? '#0f1117' : '#f5f6fa',
          },
          components: {
            Layout: { headerBg: dark ? '#151821' : '#ffffff', siderBg: dark ? '#151821' : '#ffffff', headerHeight: 60 },
            Menu: { itemBorderRadius: 8, itemMarginInline: 8 },
            Card: { headerFontSize: 15 },
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}

export const useThemeMode = () => useContext(ThemeContext);
