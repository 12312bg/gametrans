import {
  ClearOutlined,
  DownOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SelectOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Checkbox, Dropdown, Empty, Input, Pagination, Popover, Select, Space, Spin, Tooltip, Typography } from 'antd';
import {
  BATCH_ACTIONS,
  BATCH_ACTION_LABELS,
  BATCH_ACTION_PERMISSION,
  BatchAction,
  CATEGORY_LABELS,
  ENTRY_CATEGORIES,
  PERMISSIONS,
  STAGES,
  STAGE_LABELS,
  Stage,
} from '@gametrans/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, qs } from '../../api/client';
import { useProject } from '../../api/project';
import type { Entry, FileItem, HistoryItem, Paged, Suggestion, Term } from '../../api/types';
import { StageDot } from '../../components/Tags';
import { EntryPanel, EntryPanelHandle } from '../../editor/EntryPanel';
import { CodesOnly } from '../../editor/highlight';
import { errorMessage, progressOf } from '../../utils';

const PAGE_SIZE = 50;

const SHORTCUTS: [string, string][] = [
  ['Ctrl + Enter', '保存并跳到下一条'],
  ['Ctrl + S', '保存'],
  ['Ctrl + Shift + Enter', '审核通过并下一条（审核员）'],
  ['Alt + ↓ / Alt + ↑', '下一条 / 上一条'],
  ['Alt + C', '复制原文到译文'],
  ['Alt + 1~5', '使用第 N 条翻译记忆'],
];

export default function EditorPage() {
  const { project, has, canEditStage } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [params, setParams] = useSearchParams();

  const filter = {
    fileId: params.get('file') ?? '',
    stage: params.get('stage') ?? '',
    category: params.get('category') ?? '',
    q: params.get('q') ?? '',
    field: params.get('field') ?? 'all',
  };
  const page = Number(params.get('page') ?? 1);
  const selectedId = params.get('entry');
  const [search, setSearch] = useState(filter.q);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sideTab, setSideTab] = useState('tm');
  const [batchMode, setBatchMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const panelRef = useRef<EntryPanelHandle>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const selectFirstRef = useRef<'first' | 'last' | null>(null);

  useEffect(() => setSearch(filter.q), [filter.q]);

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

  const listKey = ['entries', pid, filter, page] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () =>
      api<Paged<Entry>>(
        `/projects/${pid}/entries${qs({ ...filter, field: filter.q ? filter.field : undefined, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const files = useQuery({ queryKey: ['files', pid], queryFn: () => api<FileItem[]>(`/projects/${pid}/files`) });
  const terms = useQuery({ queryKey: ['terms', pid], queryFn: () => api<Term[]>(`/projects/${pid}/terms`), staleTime: 60_000 });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const inList = items.find((e) => e.id === selectedId);
  const single = useQuery({
    queryKey: ['entry', pid, selectedId],
    queryFn: () => api<Entry>(`/projects/${pid}/entries/${selectedId}`),
    enabled: !!selectedId && !inList && !list.isFetching,
  });
  const current = inList ?? (selectedId && single.data?.id === selectedId ? single.data : undefined);
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));

  const select = useCallback((id: string | undefined) => setParam({ entry: id }, false), [setParam]);

  // 列表加载后自动选中第一条（或翻页后选中首/末条）
  useEffect(() => {
    if (!list.data || list.isPlaceholderData) return;
    if (selectFirstRef.current) {
      const pick = selectFirstRef.current === 'first' ? items[0] : items[items.length - 1];
      selectFirstRef.current = null;
      select(pick?.id);
      return;
    }
    if (!selectedId && items.length) select(items[0].id);
  }, [list.data, list.isPlaceholderData, items, selectedId, select]);

  useEffect(() => {
    if (selectedId) itemRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // 有未保存草稿时离开页面提示
  const dirtyCount = Object.entries(drafts).filter(([id, v]) => {
    const e = items.find((x) => x.id === id) ?? (current?.id === id ? current : undefined);
    return e ? e.translation !== v : true;
  }).length;
  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirtyCount]);

  const draftOf = (e: Entry) => drafts[e.id] ?? e.translation;
  const setDraft = (id: string, v: string) => setDrafts((d) => ({ ...d, [id]: v }));

  const applyUpdated = useCallback(
    (updated: Entry) => {
      qc.setQueryData<Paged<Entry>>(listKey, (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === updated.id ? updated : i)) } : old,
      );
      qc.setQueryData(['entry', pid, updated.id], updated);
      setDrafts((d) => {
        const { [updated.id]: _removed, ...rest } = d;
        return rest;
      });
      qc.invalidateQueries({ queryKey: ['project', pid], refetchType: 'none' });
      qc.invalidateQueries({ queryKey: ['stats', pid], refetchType: 'none' });
      qc.invalidateQueries({ queryKey: ['files', pid], refetchType: 'none' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, pid, JSON.stringify(listKey)],
  );

  const move = useCallback(
    (dir: 1 | -1) => {
      const idx = items.findIndex((e) => e.id === selectedId);
      const target = items[idx + dir];
      if (idx >= 0 && target) return select(target.id);
      if (dir === 1 && page < totalPages) {
        selectFirstRef.current = 'first';
        setParam({ page: String(page + 1), entry: null }, false);
      } else if (dir === -1 && page > 1) {
        selectFirstRef.current = 'last';
        setParam({ page: String(page - 1), entry: null }, false);
      } else if (dir === 1) {
        message.info('已经是最后一条了');
      }
    },
    [items, selectedId, page, totalPages, select, setParam, message],
  );

  const saveMut = useMutation({
    mutationFn: (v: { id: string; translation: string; stage?: Stage; version: number }) =>
      api<Entry>(`/projects/${pid}/entries/${v.id}`, { method: 'PUT', body: { translation: v.translation, stage: v.stage, version: v.version } }),
  });

  const save = useCallback(
    async (opts: { stage?: Stage; next?: boolean } = {}, entry = current, overrideVersion?: number) => {
      if (!entry) return;
      const translation = draftOf(entry);
      if (!opts.stage && translation === entry.translation) {
        if (opts.next) move(1);
        return;
      }
      try {
        const updated = await saveMut.mutateAsync({ id: entry.id, translation, stage: opts.stage, version: overrideVersion ?? entry.version });
        applyUpdated(updated);
        if (opts.next) move(1);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const theirs = (e.data as { current?: Entry })?.current;
          if (!theirs) return message.error(e.message);
          modal.confirm({
            title: '该词条已被其他成员修改',
            width: 560,
            content: (
              <div className="conflict-box">
                <div>
                  <div className="muted small">
                    对方的译文（{theirs.translator?.displayName ?? '未知'}）
                  </div>
                  <div className="pre-wrap conflict-text">{theirs.translation || '（空）'}</div>
                </div>
                <div>
                  <div className="muted small">你的译文</div>
                  <div className="pre-wrap conflict-text mine">{translation || '（空）'}</div>
                </div>
              </div>
            ),
            okText: '用我的覆盖',
            cancelText: '使用对方版本',
            onOk: () => save(opts, theirs, theirs.version),
            onCancel: () => applyUpdated(theirs),
          });
        } else {
          message.error(errorMessage(e));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, drafts, move, applyUpdated],
  );

  const rollback = async (h: HistoryItem) => {
    if (!current) return;
    try {
      const updated = await api<Entry>(`/projects/${pid}/entries/${current.id}/rollback`, {
        method: 'POST',
        body: { historyId: h.id, version: current.version },
      });
      applyUpdated(updated);
      message.success('已回滚');
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  // 键盘快捷键
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (!current) return;
    const mod = e.ctrlKey || e.metaKey;
    const editable = canEditStage(current.stage) && has(PERMISSIONS.TRANSLATE);
    if (mod && e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (has(PERMISSIONS.REVIEW) && draftOf(current).trim()) save({ stage: 'REVIEWED', next: true });
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      if (editable) save({ next: true });
      else move(1);
    } else if (mod && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      if (editable) save();
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.altKey && (e.code === 'KeyC' || e.key === 'c')) {
      if (!editable) return;
      e.preventDefault();
      setDraft(current.id, current.original);
    } else if (e.altKey && /^Digit[1-5]$/.test(e.code)) {
      if (!editable) return;
      const sug = qc.getQueryData<Suggestion[]>(['suggestions', current.id, current.original]);
      const s = sug?.[Number(e.code.slice(5)) - 1];
      if (s) {
        e.preventDefault();
        setDraft(current.id, s.translation);
      }
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // 切换词条后聚焦输入框
  useEffect(() => {
    if (current && canEditStage(current.stage)) requestAnimationFrame(() => panelRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // ───────── 批量操作 ─────────
  const batchActions = BATCH_ACTIONS.filter((a) => has(BATCH_ACTION_PERMISSION[a]));
  const runBatch = (action: BatchAction, scope: 'selected' | 'all') => {
    const count = scope === 'selected' ? checked.size : list.data?.total ?? 0;
    modal.confirm({
      title: `批量${BATCH_ACTION_LABELS[action]}`,
      content:
        scope === 'selected'
          ? `将对选中的 ${count} 条词条执行「${BATCH_ACTION_LABELS[action]}」，不符合条件的词条会被跳过。`
          : `将对当前筛选结果中的全部 ${count.toLocaleString()} 条词条执行「${BATCH_ACTION_LABELS[action]}」，不符合条件的词条会被跳过。`,
      okText: '确定',
      okButtonProps: { danger: action === 'clear' || action === 'hide' },
      onOk: async () => {
        try {
          const res = await api<{ affected: number }>(`/projects/${pid}/entries/batch`, {
            method: 'POST',
            body: scope === 'selected' ? { action, ids: [...checked] } : { action, filter },
          });
          message.success(`已处理 ${res.affected} 条词条`);
          setChecked(new Set());
          qc.invalidateQueries({ queryKey: ['entries', pid] });
          qc.invalidateQueries({ queryKey: ['entry', pid] });
          qc.invalidateQueries({ queryKey: ['project', pid] });
          qc.invalidateQueries({ queryKey: ['files', pid] });
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };

  const fill = async () => {
    modal.confirm({
      title: '翻译记忆填充',
      content: `将项目中已有译文填入原文完全相同的「未翻译」词条${filter.fileId ? '（仅当前文件）' : ''}，填充后状态为「已翻译」。`,
      okText: '开始填充',
      onOk: async () => {
        try {
          const res = await api<{ affected: number }>(`/projects/${pid}/tm/fill`, { method: 'POST', body: { fileId: filter.fileId || undefined } });
          message.success(res.affected ? `已填充 ${res.affected} 条词条` : '没有可填充的词条');
          qc.invalidateQueries({ queryKey: ['entries', pid] });
          qc.invalidateQueries({ queryKey: ['project', pid] });
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });
  };

  const fileOptions = (files.data ?? []).map((f) => ({
    value: f.id,
    label: (
      <div className="file-option">
        <span>{f.path}</span>
        <span className="muted small">{progressOf(f.stats).translatedPct}%</span>
      </div>
    ),
    searchText: f.path,
  }));

  const stageValue = filter.stage ? filter.stage.split(',') : [];
  const categoryValue = filter.category ? filter.category.split(',') : [];
  const pageAllChecked = items.length > 0 && items.every((i) => checked.has(i.id));

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <Space wrap size={8}>
          <Select
            style={{ width: 240 }}
            placeholder="全部文件"
            allowClear
            showSearch
            value={filter.fileId || undefined}
            onChange={(v) => setParam({ file: v })}
            options={fileOptions}
            filterOption={(input, opt) => (opt?.searchText ?? '').toLowerCase().includes(input.toLowerCase())}
            popupMatchSelectWidth={360}
          />
          <Select
            mode="multiple"
            style={{ minWidth: 160 }}
            maxTagCount="responsive"
            placeholder="全部状态（不含隐藏）"
            allowClear
            value={stageValue}
            onChange={(v: string[]) => setParam({ stage: v.join(',') })}
            options={STAGES.map((s) => ({ value: s, label: <Space size={6}><StageDot stage={s} />{STAGE_LABELS[s]}</Space> }))}
          />
          <Select
            mode="multiple"
            style={{ minWidth: 140 }}
            maxTagCount="responsive"
            placeholder="全部分类"
            allowClear
            value={categoryValue}
            onChange={(v: string[]) => setParam({ category: v.join(',') })}
            options={ENTRY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
          />
          <Space.Compact>
            <Select
              style={{ width: 96 }}
              value={filter.field}
              onChange={(v) => setParam({ field: v === 'all' ? null : v })}
              options={[
                { value: 'all', label: '全部' },
                { value: 'original', label: '原文' },
                { value: 'translation', label: '译文' },
                { value: 'key', label: '键名' },
                { value: 'context', label: '位置' },
              ]}
            />
            <Input.Search
              style={{ width: 220 }}
              allowClear
              placeholder="搜索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onSearch={(v) => setParam({ q: v.trim() || null })}
            />
          </Space.Compact>
          {(filter.fileId || filter.stage || filter.category || filter.q) && (
            <Button icon={<ClearOutlined />} onClick={() => setParam({ file: null, stage: null, category: null, q: null, field: null })}>
              清除筛选
            </Button>
          )}
        </Space>
        <Space wrap size={8}>
          {has(PERMISSIONS.REVIEW) && (
            <Tooltip title="把已有译文填入原文完全相同的未翻译词条">
              <Button icon={<ThunderboltOutlined />} onClick={fill}>
                记忆填充
              </Button>
            </Tooltip>
          )}
          {batchActions.length > 0 && (
            <Button
              type={batchMode ? 'primary' : 'default'}
              ghost={batchMode}
              icon={<SelectOutlined />}
              onClick={() => {
                setBatchMode((b) => !b);
                setChecked(new Set());
              }}
            >
              批量
            </Button>
          )}
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} onClick={() => list.refetch()} />
          </Tooltip>
          <Popover
            placement="bottomRight"
            title="快捷键"
            content={
              <table className="shortcut-table">
                <tbody>
                  {SHORTCUTS.map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <kbd>{k}</kbd>
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <Button icon={<QuestionCircleOutlined />} />
          </Popover>
        </Space>
      </div>

      {batchMode && (
        <div className="batch-bar">
          <Checkbox
            checked={pageAllChecked}
            indeterminate={!pageAllChecked && items.some((i) => checked.has(i.id))}
            onChange={(e) => {
              const next = new Set(checked);
              for (const i of items) {
                if (e.target.checked) next.add(i.id);
                else next.delete(i.id);
              }
              setChecked(next);
            }}
          >
            全选本页
          </Checkbox>
          <Typography.Text type="secondary">已选 {checked.size} 条</Typography.Text>
          <Dropdown
            disabled={!checked.size}
            menu={{ items: batchActions.map((a) => ({ key: a, label: BATCH_ACTION_LABELS[a], danger: a === 'clear', onClick: () => runBatch(a, 'selected') })) }}
          >
            <Button size="small" type="primary" disabled={!checked.size}>
              对选中项 <DownOutlined />
            </Button>
          </Dropdown>
          <Dropdown
            menu={{ items: batchActions.map((a) => ({ key: a, label: BATCH_ACTION_LABELS[a], danger: a === 'clear', onClick: () => runBatch(a, 'all') })) }}
          >
            <Button size="small">
              对全部 {list.data?.total.toLocaleString() ?? 0} 条筛选结果 <DownOutlined />
            </Button>
          </Dropdown>
        </div>
      )}

      <div className="editor-body">
        <div className="editor-list">
          <div className="list-head">
            <span>
              共 <b>{list.data?.total.toLocaleString() ?? '-'}</b> 条
            </span>
            {list.isFetching && <Spin size="small" />}
          </div>
          <div className="list-scroll">
            {list.isLoading ? (
              <div className="center-spin">
                <Spin />
              </div>
            ) : !items.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                style={{ marginTop: 60 }}
                description={project.fileCount === 0 ? '项目还没有文件' : '没有符合条件的词条'}
              />
            ) : (
              items.map((e, idx) => {
                const dirty = drafts[e.id] !== undefined && drafts[e.id] !== e.translation;
                return (
                  <div
                    key={e.id}
                    ref={(el) => {
                      if (el) itemRefs.current.set(e.id, el);
                      else itemRefs.current.delete(e.id);
                    }}
                    className={`entry-item${e.id === selectedId ? ' active' : ''}`}
                    onClick={() => select(e.id)}
                  >
                    {batchMode && (
                      <Checkbox
                        checked={checked.has(e.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => {
                          const next = new Set(checked);
                          if (ev.target.checked) next.add(e.id);
                          else next.delete(e.id);
                          setChecked(next);
                        }}
                      />
                    )}
                    <div className="entry-item-main">
                      <div className="entry-item-top">
                        <StageDot stage={e.stage} />
                        <span className="entry-index">#{(page - 1) * PAGE_SIZE + idx + 1}</span>
                        <span className="entry-cat">{CATEGORY_LABELS[e.category]}</span>
                        {dirty && <span className="dirty-dot" title="有未保存的修改" />}
                      </div>
                      <div className="entry-item-src">
                        <CodesOnly text={e.original} />
                      </div>
                      <div className={`entry-item-dst${e.translation ? '' : ' empty'}`}>
                        {dirty ? drafts[e.id] : e.translation || '未翻译'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="list-foot">
            <Pagination
              size="small"
              simple
              current={page}
              pageSize={PAGE_SIZE}
              total={list.data?.total ?? 0}
              onChange={(pg) => setParam({ page: String(pg), entry: null }, false)}
            />
          </div>
        </div>

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
              canEdit={has(PERMISSIONS.TRANSLATE) && canEditStage(current.stage)}
              saving={saveMut.isPending}
              onSave={(o) => save(o)}
              onRollback={rollback}
              onJump={(id) => select(id)}
              sideTab={sideTab}
              onSideTab={setSideTab}
            />
          ) : selectedId && single.isLoading ? (
            <div className="center-spin">
              <Spin />
            </div>
          ) : (
            <Empty style={{ marginTop: 120 }} description="选择左侧词条开始翻译" />
          )}
        </div>
      </div>
    </div>
  );
}
