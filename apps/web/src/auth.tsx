import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, createContext, useCallback, useContext } from 'react';
import { api } from './api/client';
import type { Me, SiteConfig } from './api/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  site: SiteConfig | undefined;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  site: undefined,
  refresh: async () => undefined,
  logout: async () => undefined,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me | null>('/auth/me'), staleTime: 60_000 });
  const site = useQuery({ queryKey: ['site-config'], queryFn: () => api<SiteConfig>('/auth/config'), staleTime: Infinity });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['me'] }), [qc]);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    // 直接置空登录态；qc.clear() 之后再 invalidate 不会通知仍在使用旧数据的组件
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'site-config' });
  }, [qc]);
  return (
    <AuthContext.Provider value={{ user: me.data ?? null, loading: me.isLoading, site: site.data, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
