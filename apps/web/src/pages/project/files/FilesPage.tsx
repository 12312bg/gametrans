import { DeleteOutlined, DownloadOutlined, SwapOutlined, TranslationOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Empty, Input, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import { ENGINE_EXTENSIONS, PERMISSIONS, hasMessage } from '@gametrans/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, upload } from '../../../api/client';
import { useProject } from '../../../api/project';
import type { FileItem, Job, ParseResultData } from '../../../api/types';
import { ProgressBar } from '../../../components/ProgressBar';
import { useT } from '../../../i18n';
import { issueText } from '../../../i18n/format';
import { errorMessage, formatSize, fromNow } from '../../../utils';
import { ParseJobs } from './ParseJobs';
import { UploadCard } from './UploadCard';

const isActive = (j: Job) => j.status === 'QUEUED' || j.status === 'RUNNING';

export default function FilesPage() {
  const t = useT();
  const { project, has } = useProject();
  const pid = project.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canManage = has(PERMISSIONS.MANAGE_FILES);
  const [filter, setFilter] = useState('');
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
      await upload(`/projects/${pid}/files/${target.id}/replace`, form);
      message.success(t('upload.replaced', { path: target.path }));
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

  const data = useMemo(() => (files.data ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())), [files.data, filter]);
  const openEditor = (f: FileItem) => nav(`/projects/${pid}/editor?file=${f.id}`);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {canManage && <UploadCard onUploaded={refreshJobs} />}
      {canManage && !!jobs.data?.length && <ParseJobs jobs={jobs.data} />}

      <Card
        variant="borderless"
        title={t('files.title', { count: files.data?.length ?? 0 })}
        extra={<Input.Search allowClear placeholder={t('files.filter')} onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />}
      >
        <Table<FileItem>
          rowKey="id"
          loading={files.isLoading}
          dataSource={data}
          pagination={data.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(canManage ? 'files.emptyManage' : 'files.empty')} /> }}
          scroll={{ x: 760 }}
          columns={[
            {
              title: t('files.col.file'),
              dataIndex: 'path',
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
            { title: t('files.col.progress'), width: 320, render: (_, f) => <ProgressBar stats={f.stats} height={6} /> },
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
