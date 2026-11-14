import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RtEntryPatch, RtEvent, RtPresenceItem, RtUser } from '@gametrans/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { api } from './client';
import type { Entry, Paged } from './types';

/** 其他人最近修改过的词条：用于列表闪烁与编辑面板提示 */
export interface RemoteChange {
  by: RtUser | null;
  version: number;
  at: number;
}

interface RealtimeValue {
  connected: boolean;
  presence: RtPresenceItem[];
  remote: Record<string, RemoteChange>;
  /** 上报正在编辑的词条（null 表示没有） */
  focus: (entryId: string | null) => void;
}

const Ctx = createContext<RealtimeValue>({ connected: false, presence: [], remote: {}, focus: () => undefined });

export const useRealtime = () => useContext(Ctx);

/** 把补丁合并到缓存中的词条；只接受更新的版本 */
function merge(e: Entry, p: RtEntryPatch): Entry {
  return p.version > e.version ? { ...e, ...p } : e;
}

function applyPatch(qc: QueryClient, pid: string, p: RtEntryPatch) {
  qc.setQueriesData<Paged<Entry>>({ queryKey: ['entries', pid] }, (old) =>
    old && old.items.some((i) => i.id === p.id) ? { ...old, items: old.items.map((i) => (i.id === p.id ? merge(i, p) : i)) } : old,
  );
  qc.setQueryData<Entry>(['entry', pid, p.id], (old) => (old ? merge(old, p) : old));
  // 上下文、相同字符串里显示的译文
  for (const key of ['neighbors', 'linked']) qc.invalidateQueries({ queryKey: [key] });
}

/** 合并短时间内的多次失效，避免批量操作时反复请求 */
function useDebouncedInvalidate(qc: QueryClient, pid: string) {
  const pending = useRef(new Set<string>());
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(
    (...keys: string[]) => {
      for (const k of keys) pending.current.add(k);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        for (const k of pending.current) qc.invalidateQueries({ queryKey: k === 'history' ? [k] : [k, pid] });
        pending.current.clear();
      }, 600);
    },
    [qc, pid],
  );
}

/** 项目实时连接（SSE）：同步他人的修改、在线成员与正在编辑的词条 */
export function RealtimeProvider({ pid, children }: { pid: string; children: ReactNode }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<RtPresenceItem[]>([]);
  const [remote, setRemote] = useState<Record<string, RemoteChange>>({});
  const connId = useRef<string | null>(null);
  const focused = useRef<string | null>(null);
  const invalidate = useDebouncedInvalidate(qc, pid);
  const userId = user?.id;

  const report = useCallback(() => {
    if (!connId.current || !userId) return;
    api(`/projects/${pid}/presence`, { method: 'POST', body: { connId: connId.current, entryId: focused.current } }).catch(() => undefined);
  }, [pid, userId]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let first = true;
    const es = new EventSource(`/api/projects/${pid}/events`, { withCredentials: true });
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      let ev: RtEvent;
      try {
        ev = JSON.parse(msg.data) as RtEvent;
      } catch {
        return;
      }
      switch (ev.type) {
        case 'hello':
          connId.current = ev.connId;
          setConnected(true);
          if (focused.current) report();
          // 断线重连：期间的变化无从得知，重新加载
          if (!first) invalidate('entries', 'entry', 'project', 'files', 'stats', 'terms', 'project-history');
          first = false;
          break;
        case 'entry':
          applyPatch(qc, pid, ev.entry);
          if (ev.by?.id !== userId) {
            const change = { by: ev.by, version: ev.entry.version, at: Date.now() };
            setRemote((r) => ({ ...r, [ev.entry.id]: change }));
          }
          qc.invalidateQueries({ queryKey: ['history', ev.entry.id] });
          invalidate('project', 'stats', 'files', 'project-history', 'activity');
          break;
        case 'entries':
        case 'files':
          invalidate('entries', 'entry', 'project', 'files', 'stats', 'history', 'project-history', 'activity');
          break;
        case 'terms':
          invalidate('terms', 'project-history', 'activity');
          break;
        case 'presence':
          setPresence(ev.items);
          break;
      }
    };
    return () => {
      es.close();
      connId.current = null;
      setConnected(false);
      setPresence([]);
    };
  }, [pid, qc, userId, invalidate, report]);

  // 提示只保留一段时间
  useEffect(() => {
    if (!Object.keys(remote).length) return;
    const id = window.setTimeout(() => {
      const now = Date.now();
      setRemote((r) => Object.fromEntries(Object.entries(r).filter(([, v]) => now - v.at < 60_000)));
    }, 60_000);
    return () => window.clearTimeout(id);
  }, [remote]);

  const focus = useCallback(
    (entryId: string | null) => {
      if (focused.current === entryId) return;
      focused.current = entryId;
      report();
    },
    [report],
  );

  const value = useMemo(() => ({ connected, presence, remote, focus }), [connected, presence, remote, focus]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 除自己以外正在编辑各词条的成员 */
export function useEditors(): Map<string, RtUser[]> {
  const { presence } = useRealtime();
  const { user } = useAuth();
  return useMemo(() => {
    const m = new Map<string, RtUser[]>();
    for (const p of presence) {
      if (p.user.id === user?.id) continue;
      for (const id of p.entryIds) m.set(id, [...(m.get(id) ?? []), p.user]);
    }
    return m;
  }, [presence, user?.id]);
}
