import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Empty, Spin } from 'antd';
import { BATCH_ACTIONS, BATCH_ACTION_PERMISSION, BatchAction, PERMISSIONS, Stage } from '@gametrans/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, qs } from '../../../api/client';
import { useProject } from '../../../api/project';
import type { Entry, FileItem, HistoryItem, Paged, Suggestion, Term } from '../../../api/types';
import { useT } from '../../../i18n';
import { errorMessage } from '../../../utils';
import { BatchBar, EditorToolbar, EntryFilter } from './EditorToolbar';
import { EntryList, PAGE_SIZES } from './EntryList';
import { EntryPanel, EntryPanelHandle } from './EntryPanel';
import { useShortcuts } from './useShortcuts';

const SIZE_KEY = 'gt-editor-page-size';

function savedPageSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    if (PAGE_SIZES.includes(n)) return n;
  } catch {
    /* 隐私模式下不可用 */
  }
  return 50;
}

export default function EditorPage() {
  const t = useT();
  const { project, has, canEditStage } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();

  const filter: EntryFilter = {
    fileId: params.get('file') ?? '',
    stage: params.get('stage') ?? '',
    category: params.get('category') ?? '',
    q: params.get('q') ?? '',
    field: params.get('field') ?? 'all',
  };
  const page = Number(params.get('page') ?? 1);
  const sizeParam = Number(params.get('size'));
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : savedPageSize();
  const selectedId = params.get('entry');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sideTab, setSideTab] = useState('tm');
  const [batchMode, setBatchMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const panelRef = useRef<EntryPanelHandle>(null);
  const selectAfterLoad = useRef<'first' | 'last' | null>(null);

  /** 修改筛选条件时回到第一页并取消选中 */
  const setParam = useCallback(
    (patch: Record<string, string | null | undefined>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          if (resetPage && !('entry' in patch)) next.delete('entry');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const listKey = ['entries', pid, filter, page, pageSize] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => api<Paged<Entry>>(`/projects/${pid}/entries${qs({ ...filter, field: filter.q ? filter.field : undefined, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  const files = useQuery({ queryKey: ['files', pid], queryFn: () => api<FileItem[]>(`/projects/${pid}/files`) });
  const terms = useQuery({ queryKey: ['terms', pid], queryFn: () => api<Term[]>(`/projects/${pid}/terms`), staleTime: 60_000 });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const inList = items.find((e) => e.id === selectedId);
  // 通过链接或上下文跳转到不在当前列表中的词条
  const single = useQuery({
    queryKey: ['entry', pid, selectedId],
    queryFn: () => api<Entry>(`/projects/${pid}/entries/${selectedId}`),
    enabled: !!selectedId && !inList && !list.isFetching,
  });
  const current = inList ?? (selectedId && single.data?.id === selectedId ? single.data : undefined);
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / pageSize));
  const select = useCallback((id: string | undefined) => setParam({ entry: id }, false), [setParam]);

  /** 翻页时选中新页第一条；改每页条数时停在包含当前词条的那一页 */
  const changePage = (pg: number, size: number) => {
    if (size === pageSize) return setParam({ page: String(pg), entry: null }, false);
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch {
      /* ignore */
    }
    const idx = Math.max(0, items.findIndex((e) => e.id === selectedId));
    const newPage = Math.floor(((page - 1) * pageSize + idx) / size) + 1;
    setParam({ page: newPage > 1 ? String(newPage) : null, size: String(size) }, false);
  };

  useEffect(() => {
    if (!list.data || list.isPlaceholderData) return;
    if (selectAfterLoad.current) {
      const pick = selectAfterLoad.current === 'first' ? items[0] : items[items.length - 1];
      selectAfterLoad.current = null;
      select(pick?.id);
    } else if (!selectedId && items.length) {
      select(items[0].id);
    }
  }, [list.data, list.isPlaceholderData, items, selectedId, select]);

  const hasDirty = Object.entries(drafts).some(([id, v]) => {
    const e = items.find((x) => x.id === id) ?? (current?.id === id ? current : undefined);
    return !e || e.translation !== v;
  });
  useEffect(() => {
    if (!hasDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasDirty]);

  const draftOf = (e: Entry) => drafts[e.id] ?? e.translation;
  const setDraft = (id: string, v: string) => setDrafts((d) => ({ ...d, [id]: v }));

  const applyUpdated = (updated: Entry) => {
    qc.setQueryData<Paged<Entry>>(listKey, (old) => (old ? { ...old, items: old.items.map((i) => (i.id === updated.id ? updated : i)) } : old));
    qc.setQueryData(['entry', pid, updated.id], updated);
    setDrafts(({ [updated.id]: _, ...rest }) => rest);
    for (const key of ['project', 'stats', 'files']) qc.invalidateQueries({ queryKey: [key, pid], refetchType: 'none' });
  };

  const refreshAll = () => {
    for (const key of ['entries', 'entry', 'project', 'files']) qc.invalidateQueries({ queryKey: [key, pid] });
  };

  const move = (dir: 1 | -1) => {
    const idx = items.findIndex((e) => e.id === selectedId);
    const target = items[idx + dir];
    if (idx >= 0 && target) return select(target.id);
    if (dir === 1 && page < totalPages) {
      selectAfterLoad.current = 'first';
      setParam({ page: String(page + 1), entry: null }, false);
    } else if (dir === -1 && page > 1) {
      selectAfterLoad.current = 'last';
      setParam({ page: String(page - 1), entry: null }, false);
    } else if (dir === 1) {
      message.info(t('editor.lastEntry'));
    }
  };

  const saveMut = useMutation({
    mutationFn: (v: { id: string; translation: string; stage?: Stage; version: number }) =>
      api<Entry>(`/projects/${pid}/entries/${v.id}`, { method: 'PUT', body: { translation: v.translation, stage: v.stage, version: v.version } }),
  });

  const save = async (opts: { stage?: Stage; next?: boolean } = {}, entry = current, version?: number): Promise<void> => {
    if (!entry) return;
    const translation = draftOf(entry);
    if (!opts.stage && translation === entry.translation) {
      if (opts.next) move(1);
      return;
    }
    try {
      applyUpdated(await saveMut.mutateAsync({ id: entry.id, translation, stage: opts.stage, version: version ?? entry.version }));
      if (opts.next) move(1);
    } catch (e) {
      const theirs = e instanceof ApiError && e.code === 'ENTRY_CONFLICT' ? (e.data as { current?: Entry }).current : undefined;
      if (!theirs) return void message.error(errorMessage(e));
      modal.confirm({
        title: t('editor.conflictTitle'),
        width: 560,
        content: (
          <div className="conflict-box">
            <div>
              <div className="muted small">{t('editor.conflictTheirs', { name: theirs.translator?.displayName ?? t('common.unknown') })}</div>
              <div className="pre-wrap conflict-text">{theirs.translation || t('common.empty')}</div>
            </div>
            <div>
              <div className="muted small">{t('editor.conflictMine')}</div>
              <div className="pre-wrap conflict-text mine">{translation || t('common.empty')}</div>
            </div>
          </div>
        ),
        okText: t('editor.conflictOverwrite'),
        cancelText: t('editor.conflictUseTheirs'),
        onOk: () => save(opts, theirs, theirs.version),
        onCancel: () => applyUpdated(theirs),
      });
    }
  };

  /** 只看该词条所在的文件（清除搜索与分类），并停在包含它的那一页 */
  const jumpToFile = async (e: Entry) => {
    const next = { ...filter, fileId: e.fileId, q: '', category: '' };
    let page = 1;
    try {
      const { index } = await api<{ index: number | null }>(`/projects/${pid}/entries/${e.id}/position${qs({ ...next, field: undefined })}`);
      if (index !== null) page = Math.floor(index / pageSize) + 1;
    } catch {
      /* 定位失败时停在第一页，当前词条仍保持选中 */
    }
    setParam({ file: e.fileId, q: null, field: null, category: null, page: page > 1 ? String(page) : null, entry: e.id }, false);
  };

  const rollback = async (h: HistoryItem) => {
    if (!current) return;
    try {
      applyUpdated(await api<Entry>(`/projects/${pid}/entries/${current.id}/rollback`, { method: 'POST', body: { historyId: h.id, version: current.version } }));
      message.success(t('editor.rolledBack'));
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const editable = !!current && has(PERMISSIONS.TRANSLATE) && canEditStage(current.stage);
  useShortcuts({
    current,
    editable,
    canReview: has(PERMISSIONS.REVIEW),
    draftOf,
    setDraft,
    save,
    move,
    suggestion: (e, n) => qc.getQueryData<Suggestion[]>(['suggestions', e.id, e.original])?.[n]?.translation,
  });

  useEffect(() => {
    if (editable) requestAnimationFrame(() => panelRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const batchActions = BATCH_ACTIONS.filter((a) => has(BATCH_ACTION_PERMISSION[a]));
  const runBatch = (action: BatchAction, scope: 'selected' | 'all') => {
    const label = t(`batch.${action}`);
    const count = scope === 'selected' ? checked.size : list.data?.total ?? 0;
    modal.confirm({
      title: t('editor.batchTitle', { action: label }),
      content: t(scope === 'selected' ? 'editor.batchSelectedDesc' : 'editor.batchAllDesc', { action: label, count: count.toLocaleString() }),
      okButtonProps: { danger: action === 'clear' || action === 'hide' },
      onOk: async () => {
        try {
          const res = await api<{ affected: number }>(`/projects/${pid}/entries/batch`, {
            method: 'POST',
            body: scope === 'selected' ? { action, ids: [...checked] } : { action, filter },
          });
          message.success(t('editor.batchDone', { count: res.affected }));
          setChecked(new Set());
          refreshAll();
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };

  const fill = () =>
    modal.confirm({
      title: t('editor.fillTitle'),
      content: t(filter.fileId ? 'editor.fillDescFile' : 'editor.fillDesc'),
      okText: t('editor.fillOk'),
      onOk: async () => {
        try {
          const res = await api<{ affected: number }>(`/projects/${pid}/tm/fill`, { method: 'POST', body: { fileId: filter.fileId || undefined } });
          message.success(res.affected ? t('editor.filled', { count: res.affected }) : t('editor.nothingToFill'));
          refreshAll();
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });

  return (
    <div className="editor">
      <EditorToolbar
        filter={filter}
        setParam={setParam}
        files={files.data ?? []}
        canFill={has(PERMISSIONS.REVIEW)}
        onFill={fill}
        canBatch={batchActions.length > 0}
        batchMode={batchMode}
        onToggleBatch={() => {
          setBatchMode((b) => !b);
          setChecked(new Set());
        }}
        onRefresh={() => list.refetch()}
      />
      {batchMode && (
        <BatchBar actions={batchActions} pageIds={items.map((i) => i.id)} checked={checked} onChecked={setChecked} total={list.data?.total ?? 0} onRun={runBatch} />
      )}

      <div className="editor-body">
        <EntryList
          items={items}
          total={list.data?.total}
          loading={list.isLoading}
          fetching={list.isFetching}
          emptyText={t(project.fileCount === 0 ? 'editor.noFiles' : 'editor.noEntries')}
          page={page}
          pageSize={pageSize}
          onPage={changePage}
          selectedId={selectedId}
          onSelect={select}
          drafts={drafts}
          batchMode={batchMode}
          checked={checked}
          onChecked={setChecked}
        />
        <div className="editor-detail">
          {current ? (
            <EntryPanel
              ref={panelRef}
              key={current.id}
              pid={pid}
              engine={project.engine}
              entry={current}
              draft={draftOf(current)}
              onDraft={(v) => setDraft(current.id, v)}
              terms={terms.data ?? []}
              has={has}
              canEdit={editable}
              saving={saveMut.isPending}
              onSave={(o) => void save(o)}
              onRollback={rollback}
              onJump={select}
              onFile={() => void jumpToFile(current)}
              sideTab={sideTab}
              onSideTab={setSideTab}
            />
          ) : selectedId && single.isLoading ? (
            <div className="center-spin">
              <Spin />
            </div>
          ) : (
            <Empty style={{ marginTop: 120 }} description={t('editor.pickEntry')} />
          )}
        </div>
      </div>
    </div>
  );
}
