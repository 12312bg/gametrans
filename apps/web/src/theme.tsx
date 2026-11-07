import { ConfigProvider, App as AntApp, theme as antTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';

type Mode = 'light' | 'dark';

const ThemeContext = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => undefined });

function initialMode(): Mode {
  try {
    const saved = localStorage.getItem('gt-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* 隐私模式下无法读取 */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const BRAND = '#6366f1';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    try {
      localStorage.setItem('gt-theme', mode);
    } catch {
      /* ignore */
    }
  }, [mode]);
  const value = useMemo(() => ({ mode, toggle: () => setMode((m) => (m === 'light' ? 'dark' : 'light')) }), [mode]);
  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
          token: {
            colorPrimary: BRAND,
            colorInfo: BRAND,
            borderRadius: 8,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans JP", sans-serif',
            colorBgLayout: mode === 'dark' ? '#0f1117' : '#f5f6fa',
          },
          components: {
            Layout: { headerBg: mode === 'dark' ? '#151821' : '#ffffff', siderBg: mode === 'dark' ? '#151821' : '#ffffff', headerHeight: 60 },
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
