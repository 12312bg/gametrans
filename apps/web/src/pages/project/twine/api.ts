import { useQuery } from '@tanstack/react-query';
import type { TwineMacroRule, TwineMacroStat } from '@gametrans/shared';
import { api } from '../../../api/client';

export interface RulesResponse {
  builtin: TwineMacroRule[];
  macros: TwineMacroRule[];
  ignored: string[];
}

export type MacroStatus = 'configured' | 'ignored' | 'new';

export interface AnalyzedMacro extends TwineMacroStat {
  status: MacroStatus;
}

export interface AnalysisResponse {
  files: number;
  macros: AnalyzedMacro[];
  /** 有推荐、但还没有确认的宏 */
  pending: string[];
}

export interface PreviewResponse {
  total: number;
  current: number;
  added: number;
  removed: number;
  perMacro: Record<string, { count: number; samples: string[] }>;
}

// 确认界面中有未保存的选择，不在切回窗口时自动刷新（保存后显式刷新）
export const useTwineRules = (pid: string) =>
  useQuery({ queryKey: ['twineRules', pid], queryFn: () => api<RulesResponse>(`/projects/${pid}/twine/rules`), refetchOnWindowFocus: false });

export const useTwineAnalysis = (pid: string, enabled = true) =>
  useQuery({
    queryKey: ['twineMacros', pid],
    queryFn: () => api<AnalysisResponse>(`/projects/${pid}/twine/macros`),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
