import { CloudUploadOutlined, DeleteOutlined, DownloadOutlined, LoadingOutlined, ReloadOutlined, SwapOutlined, TranslationOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Card, Divider, Drawer, Empty, Input, Pagination, Popconfirm, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { SortOrder } from 'antd/es/table/interface';
import { ENGINE_EXTENSIONS, PERMISSIONS, hasMessage } from '@gametrans/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, upload } from '../../../api/client';
import { useProject } from '../../../api/project';
import type { FileItem, Job, ParseResultData } from '../../../api/types';
import { ProgressBar } from '../../../components/ProgressBar';
import { useT } from '../../../i18n';
import { issueText } from '../../../i18n/format';
import { errorMessage, formatSize, fromNow, progressOf } from '../../../utils';
import { ParseJobs } from './ParseJobs';
import { PreviewModal } from './PreviewModal';
import { UploadCard } from './UploadCard';

const isActive = (j: Job) => j.status === 'QUEUED' || j.status === 'RUNNING';

const PAGE_SIZES = [20, 50, 100, 200];
const SIZE_KEY = 'gt-files-page-size';
const SORT_KEYS = ['path', 'total', 'translated', 'translatedPct', 'reviewedPct', 'untranslated', 'updated'] as const;
type SortKey = (typeof SORT_KEYS)[number];

function savedPageSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    if (PAGE_SIZES.includes(n)) return n;
  } catch {
    /* 隐私模式下不可用 */
  }
  return 20;
}

/** 排序用的数值 */
function sortValue(f: FileItem, key: SortKey): number | string {
  const p = progressOf(f.stats);
  switch (key) {
    case 'path':
      return f.path.toLowerCase();
    case 'total':
      return p.total;
    case 'translated':
      return p.translated;
    case 'translatedPct':
      return p.translatedPct;
    case 'reviewedPct':
      return p.reviewedPct;
    case 'untranslated':
      return p.total - p.translated;
    case 'updated':
      return new Date(f.updatedAt).getTime();
  }
}

export default function FilesPage() {
  const t = useT();
  const { project, has } = useProject();
  const pid = project.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canManage = has(PERMISSIONS.MANAGE_FILES);
  const [filter, setFilter] = useState('');
  const [params, setParams] = useSearchParams();
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(params.get('sort') ?? '') ? (params.get('sort') as SortKey) : 'path';
  const order: 'asc' | 'desc' = params.get('order') === 'desc' ? 'desc' : params.get('order') === 'asc' ? 'asc' : sortKey === 'path' ? 'asc' : 'desc';
  const sizeParam = Number(params.get('size'));
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : savedPageSize();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const setParam = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  const setSort = (key: SortKey, ord?: 'asc' | 'desc') => setParam({ sort: key === 'path' ? null : key, order: ord ?? null, page: null });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewJob, setPreviewJob] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<FileItem | null>(null);

  const files = useQuery({ queryKey: ['files', pid], queryFn: () => api<FileItem[]>(`/projects/${pid}/files`) });
  const jobs = useQuery({
    queryKey: ['jobs', pid, 'PARSE'],
    queryFn: () => api<Job<ParseResultData>[]>(`/projects/${pid}/jobs?type=PARSE`),
    enabled: canManage,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? 1500 : false),
  });
  const refreshJobs = () => qc.invalidateQueries({ queryKey: ['jobs', pid, 'PARSE'] });
  const refreshFiles = () => {
    for (const key of ['files', 'project', 'entries', 'stats']) qc.invalidateQueries({ queryKey: [key, pid] });
  };

  // 解析任务结束后刷新文件与统计
  const running = !!jobs.data?.some(isActive);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) refreshFiles();
    wasRunning.current = running;
  });

  const replace = async (f: File) => {
    const target = replaceTarget.current;
    if (!target) return;
    const form = new FormData();
    form.append('files', f, f.name);
    try {
      const job = await upload<Job>(`/projects/${pid}/files/${target.id}/replace?preview=true`, form);
      setPreviewJob(job.id);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const reextract = async () => {
    try {
      await api(`/projects/${pid}/files/reextract`, { method: 'POST' });
      message.success(t('files.reextractStarted'));
      refreshJobs();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const remove = async (f: FileItem) => {
    try {
      await api(`/projects/${pid}/files/${f.id}`, { method: 'DELETE' });
      message.success(t('files.deleted'));
      refreshFiles();
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const data = useMemo(() => {
    const list = (files.data ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()));
    const dir = order === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = sortValue(a, sortKey);
      const y = sortValue(b, sortKey);
      // 相同时按路径排序，保证顺序稳定
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.path.localeCompare(b.path);
    });
  }, [files.data, filter, sortKey, order]);
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageData = data.slice((curPage - 1) * pageSize, curPage * pageSize);
  const tableTop = useRef<HTMLDivElement>(null);
  const changePage = (pg: number, size: number) => {
    if (size !== pageSize) {
      try {
        localStorage.setItem(SIZE_KEY, String(size));
      } catch {
        /* ignore */
      }
    }
    setParam({ page: pg > 1 && size === pageSize ? String(pg) : null, size: size === 20 ? null : String(size) });
    // 翻页后回到列表顶部
    tableTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const sorterOf = (key: SortKey): SortOrder => (sortKey === key ? (order === 'asc' ? 'ascend' : 'descend') : null);
  const openEditor = (f: FileItem) => nav(`/projects/${pid}/editor?file=${f.id}`);
  const existingPaths = useMemo(() => new Set((files.data ?? []).map((f) => f.path)), [files.data]);
  const parseJobs = (jobs.data ?? []).filter((j) => !j.payload?.preview);
  const activeJob = parseJobs.find(isActive);
  const noFiles = files.isSuccess && !files.data.length;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {canManage && noFiles && <UploadCard existingPaths={existingPaths} onUploaded={refreshJobs} onPreview={setPreviewJob} />}
      {canManage && (
        <Drawer title={t('files.uploadDrawer')} width={640} open={uploadOpen} onClose={() => setUploadOpen(false)} destroyOnClose={false}>
          <UploadCard bare existingPaths={existingPaths} onUploaded={refreshJobs} onPreview={setPreviewJob} />
          {parseJobs.length > 0 && (
            <>
              <Divider orientation="left" plain>
                {t('jobs.title')}
              </Divider>
              <ParseJobs bare jobs={parseJobs} />
            </>
          )}
        </Drawer>
      )}
      {previewJob && (
        <PreviewModal
          pid={pid}
          jobId={previewJob}
          onClose={() => {
            setPreviewJob(null);
            refreshJobs();
          }}
        />
      )}

      <Card
        variant="borderless"
        title={t('files.title', { count: files.data?.length ?? 0 })}
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder={t('files.filter')}
              onChange={(e) => {
                setFilter(e.target.value);
                setParam({ page: null });
              }}
              style={{ width: 200 }}
            />
            <Select
              style={{ width: 190 }}
              aria-label={t('files.sort')}
              value={`${sortKey}:${order}`}
              onChange={(v: string) => {
                const [k, o] = v.split(':') as [SortKey, 'asc' | 'desc'];
                setSort(k, o);
              }}
              options={SORT_KEYS.flatMap((k) => (['desc', 'asc'] as const).map((o) => ({ value: `${k}:${o}`, label: t(`files.sort.${k}.${o}`) })))}
            />
            {canManage && !noFiles && (
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>
                {t('files.upload')}
              </Button>
            )}
            {canManage && parseJobs.length > 0 && (
              <Button icon={activeJob ? <LoadingOutlined /> : undefined} onClick={() => setUploadOpen(true)}>
                {activeJob ? t('files.jobRunning', { pct: activeJob.progress }) : <Badge dot={parseJobs[0]?.status === 'FAILED'}>{t('jobs.title')}</Badge>}
              </Button>
            )}
            {canManage && !!files.data?.length && (
              <Popconfirm title={t('files.reextractConfirm')} description={<div style={{ maxWidth: 320 }}>{t('files.reextractDesc')}</div>} onConfirm={reextract}>
                <Button icon={<ReloadOutlined />} disabled={running}>
                  {t('files.reextract')}
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <div ref={tableTop} className="files-table-anchor" />
        <Table<FileItem>
          rowKey="id"
          loading={files.isLoading}
          dataSource={pageData}
          size="middle"
          pagination={false}
          sticky={{ offsetHeader: 64 }}
          showSorterTooltip={false}
          onChange={(_p, _f, sorter) => {
            const s = Array.isArray(sorter) ? sorter[0] : sorter;
            const key = s?.columnKey as SortKey | undefined;
            if (!s?.order || !key) setSort('path');
            else setSort(key, s.order === 'ascend' ? 'asc' : 'desc');
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(canManage ? 'files.emptyManage' : 'files.empty')} /> }}
          scroll={{ x: 760 }}
          columns={[
            {
              title: t('files.col.file'),
              dataIndex: 'path',
              key: 'path',
              sorter: true,
              sortOrder: sorterOf('path'),
              sortDirections: ['ascend', 'descend'],
              render: (path: string, f) => (
                <div>
                  <a onClick={() => openEditor(f)} className="file-path">
                    {path}
                  </a>
                  <div className="muted small">
                    {hasMessage(`kind.${f.kind}`) ? t(`kind.${f.kind}`) : f.kind} · {formatSize(f.size)} · {t('common.updatedAgo', { time: fromNow(f.updatedAt) })}
                    {f.warnings.length > 0 && (
                      <Tooltip title={<div className="pre-wrap">{f.warnings.map((w) => issueText(w, t)).join('\n')}</div>}>
                        <Tag color="orange" bordered={false} style={{ marginLeft: 6 }}>
                          {t('files.warnings', { count: f.warnings.length })}
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ),
            },
            {
              title: t('files.col.total'),
              key: 'total',
              width: 100,
              align: 'right',
              sorter: true,
              sortOrder: sorterOf('total'),
              sortDirections: ['descend', 'ascend'],
              render: (_, f) => progressOf(f.stats).total.toLocaleString(),
            },
            {
              title: t('files.col.translated'),
              key: 'translatedPct',
              width: 120,
              align: 'right',
              sorter: true,
              sortOrder: sorterOf('translatedPct'),
              sortDirections: ['descend', 'ascend'],
              render: (_, f) => {
                const p = progressOf(f.stats);
                return (
                  <Tooltip title={t('files.countOf', { n: p.translated.toLocaleString(), total: p.total.toLocaleString() })}>
                    <span>{p.translatedPct}%</span>
                  </Tooltip>
                );
              },
            },
            {
              title: t('files.col.reviewed'),
              key: 'reviewedPct',
              width: 120,
              align: 'right',
              sorter: true,
              sortOrder: sorterOf('reviewedPct'),
              sortDirections: ['descend', 'ascend'],
              render: (_, f) => {
                const p = progressOf(f.stats);
                return (
                  <Tooltip title={t('files.countOf', { n: p.reviewed.toLocaleString(), total: p.total.toLocaleString() })}>
                    <span>{p.reviewedPct}%</span>
                  </Tooltip>
                );
              },
            },
            { title: t('files.col.progress'), width: 240, render: (_, f) => <ProgressBar stats={f.stats} height={6} /> },
            {
              title: t('files.col.actions'),
              width: canManage ? 200 : 80,
              render: (_, f) => (
                <Space size={0}>
                  <Tooltip title={t('files.translate')}>
                    <Button type="text" icon={<TranslationOutlined />} onClick={() => openEditor(f)} />
                  </Tooltip>
                  {canManage && (
                    <>
                      <Tooltip title={t('files.replace')}>
                        <Button
                          type="text"
                          icon={<SwapOutlined />}
                          onClick={() => {
                            replaceTarget.current = f;
                            replaceInput.current?.click();
                          }}
                        />
                      </Tooltip>
                      <Tooltip title={t('files.download')}>
                        <Button type="text" icon={<DownloadOutlined />} href={`/api/projects/${pid}/files/${f.id}/download`} />
                      </Tooltip>
                      <Popconfirm
                        title={t('files.deleteConfirm')}
                        description={t('files.deleteDesc')}
                        okText={t('common.delete')}
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove(f)}
                      >
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </>
                  )}
                </Space>
              ),
            },
          ]}
        />
        {data.length > 0 && (
          <div className="files-pager">
            <Typography.Text type="secondary" className="small">
              {t('files.range', { from: ((curPage - 1) * pageSize + 1).toLocaleString(), to: Math.min(curPage * pageSize, data.length).toLocaleString(), total: data.length.toLocaleString() })}
            </Typography.Text>
            <Pagination size="small" current={curPage} pageSize={pageSize} total={data.length} showSizeChanger pageSizeOptions={PAGE_SIZES} showQuickJumper={totalPages > 5} onChange={changePage} />
          </div>
        )}
        <input
          ref={replaceInput}
          type="file"
          accept={ENGINE_EXTENSIONS[project.engine].join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void replace(f);
            e.target.value = '';
          }}
        />
      </Card>
    </Space>
  );
}
