import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Locale, isLocale } from '@gametrans/shared';
import { ReactNode, createContext, useCallback, useContext, useEffect } from 'react';
import { api, setUploadLimit } from '../api/client';
import type { Me, SiteConfig } from '../api/types';
import { applyLocale, currentLocale } from '../i18n';

interface AuthState {
  user: Me | null;
  loading: boolean;
  site: SiteConfig | undefined;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  /** 切换界面语言，登录用户同时保存到账号 */
  setLanguage: (locale: Locale) => void;
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState);

const saveLocale = (locale: Locale) => api('/users/me', { method: 'PATCH', body: { locale } }).catch(() => undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me | null>('/auth/me'), staleTime: 60_000 });
  const site = useQuery({ queryKey: ['site-config'], queryFn: () => api<SiteConfig>('/auth/config'), staleTime: Infinity });
  const user = me.data ?? null;

  useEffect(() => setUploadLimit(site.data?.uploadLimitMb), [site.data]);

  // 账号里保存的语言优先；首次登录时把当前语言记到账号
  useEffect(() => {
    if (!user) return;
    if (isLocale(user.locale)) {
      if (user.locale !== currentLocale()) applyLocale(user.locale);
    } else {
      void saveLocale(currentLocale());
    }
  }, [user]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['me'] }), [qc]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    // 直接置空登录态；qc.clear() 之后再 invalidate 不会通知仍在使用旧数据的组件
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'site-config' });
  }, [qc]);
  const setLanguage = useCallback(
    (locale: Locale) => {
      applyLocale(locale);
      if (user) {
        qc.setQueryData<Me | null>(['me'], (m) => (m ? { ...m, locale } : m));
        void saveLocale(locale);
      }
    },
    [user, qc],
  );

  return (
    <AuthContext.Provider value={{ user, loading: me.isLoading, site: site.data, refresh, logout, setLanguage }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
