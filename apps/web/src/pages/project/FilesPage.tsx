import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  SwapOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Collapse, Empty, Input, List, Popconfirm, Progress, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { ENGINE_EXTENSIONS, PERMISSIONS } from '@gametrans/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, upload } from '../../api/client';
import { useProject } from '../../api/project';
import type { FileItem, Job, ParseResultData } from '../../api/types';
import { ProgressBar } from '../../components/ProgressBar';
import { errorMessage, formatSize, fromNow } from '../../utils';

const KIND_LABELS: Record<string, string> = {
  map: '地图',
  actors: '角色',
  classes: '职业',
  skills: '技能',
  items: '物品',
  weapons: '武器',
  armors: '防具',
  enemies: '敌人',
  states: '状态',
  troops: '敌群',
  common_events: '公共事件',
  system: '系统',
  scripts: '脚本',
  plugins: '插件',
};

function JobResult({ job }: { job: Job<ParseResultData> }) {
  const r = job.result;
  if (job.status === 'FAILED') return <Typography.Text type="danger">{job.error}</Typography.Text>;
  if (!r) return null;
  const created = r.files.filter((f) => f.status === 'created').length;
  const updated = r.files.filter((f) => f.status === 'updated').length;
  const unchanged = r.files.filter((f) => f.status === 'unchanged').length;
  const added = r.files.reduce((n, f) => n + f.added, 0);
  const changed = r.files.reduce((n, f) => n + f.changed, 0);
  const removed = r.files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="job-result">
      <Space size={[12, 4]} wrap>
        <span>新增文件 {created}</span>
        <span>更新 {updated}</span>
        {unchanged > 0 && <span>未变化 {unchanged}</span>}
        <span>新增词条 {added.toLocaleString()}</span>
        {changed > 0 && <Tag color="orange" bordered={false}>原文变更 {changed}</Tag>}
        {removed > 0 && <span>移除词条 {removed}</span>}
      </Space>
      {(r.skipped.length > 0 || r.errors.length > 0) && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 's',
              label: (
                <Typography.Text type="secondary">
                  跳过 {r.skipped.length} 个，失败 {r.errors.length} 个
                </Typography.Text>
              ),
              children: (
                <List
                  size="small"
                  dataSource={[...r.errors.map((e) => ({ ...e, err: true })), ...r.skipped.map((s) => ({ name: s.name, message: s.reason, err: false }))]}
                  renderItem={(x) => (
                    <List.Item>
                      <Typography.Text type={x.err ? 'danger' : 'secondary'}>
                        {x.name}：{x.message}
                      </Typography.Text>
                    </List.Item>
                  )}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

export default function FilesPage() {
  const { project, has } = useProject();
  const pid = project.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canManage = has(PERMISSIONS.MANAGE_FILES);
  const [pending, setPending] = useState<{ file: File; path: string }[]>([]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const folderInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<FileItem | null>(null);

  const files = useQuery({ queryKey: ['files', pid], queryFn: () => api<FileItem[]>(`/projects/${pid}/files`) });
  const jobs = useQuery({
    queryKey: ['jobs', pid, 'PARSE'],
    queryFn: () => api<Job<ParseResultData>[]>(`/projects/${pid}/jobs?type=PARSE`),
    enabled: canManage,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 1500 : false),
  });

  // 任务完成后刷新文件列表
  const running = jobs.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      qc.invalidateQueries({ queryKey: ['files', pid] });
      qc.invalidateQueries({ queryKey: ['project', pid] });
      qc.invalidateQueries({ queryKey: ['entries', pid] });
      qc.invalidateQueries({ queryKey: ['stats', pid] });
    }
    wasRunning.current = !!running;
  }, [running, qc, pid]);

  const exts = [...ENGINE_EXTENSIONS[project.engine], '.zip'];
  const accept = exts.join(',');

  const addFiles = (list: File[]) => {
    const picked = list
      .filter((f) => exts.some((e) => f.name.toLowerCase().endsWith(e)))
      .map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));
    if (picked.length < list.length) message.info(`已忽略 ${list.length - picked.length} 个不支持的文件`);
    setPending((p) => {
      const map = new Map(p.map((x) => [x.path, x]));
      for (const x of picked) map.set(x.path, x);
      return [...map.values()];
    });
  };

  const submit = async () => {
    if (!pending.length) return;
    const form = new FormData();
    for (const p of pending) form.append('files', p.file, p.file.name);
    form.append('paths', JSON.stringify(pending.map((p) => p.path)));
    setUploadPct(0);
    try {
      await upload(`/projects/${pid}/files`, form, setUploadPct);
      message.success('上传完成，正在后台解析');
      setPending([]);
      qc.invalidateQueries({ queryKey: ['jobs', pid, 'PARSE'] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setUploadPct(null);
    }
  };

  const replace = async (f: File) => {
    const target = replaceTarget.current;
    if (!target) return;
    const form = new FormData();
    form.append('files', f, f.name);
    try {
      await upload(`/projects/${pid}/files/${target.id}/replace`, form);
      message.success(`已提交 ${target.path} 的新版本，正在解析`);
      qc.invalidateQueries({ queryKey: ['jobs', pid, 'PARSE'] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const remove = async (f: FileItem) => {
    try {
      await api(`/projects/${pid}/files/${f.id}`, { method: 'DELETE' });
      message.success('已删除');
      qc.invalidateQueries({ queryKey: ['files', pid] });
      qc.invalidateQueries({ queryKey: ['project', pid] });
      qc.invalidateQueries({ queryKey: ['entries', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const data = useMemo(
    () => (files.data ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())),
    [files.data, filter],
  );

  const uploadList: UploadFile[] = pending.map((p) => ({ uid: p.path, name: p.path, size: p.file.size, status: 'done' }));

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {canManage && (
        <Card variant="borderless" title="上传游戏数据">
          <Upload.Dragger
            multiple
            accept={accept}
            showUploadList={false}
            beforeUpload={(_f, list) => {
              if (_f === list[0]) addFiles(list as unknown as File[]);
              return false;
            }}
          >
            <p className="ant-upload-drag-icon">
              <CloudUploadOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此处</p>
            <p className="ant-upload-hint">
              支持 {ENGINE_EXTENSIONS[project.engine].join(' / ')} 数据文件，或整个游戏目录的 <FileZipOutlined /> zip 压缩包。
              {project.engine === 'RMMV' || project.engine === 'RMMZ' ? ' 插件参数请上传 js/plugins.js。' : ' 加密的 .rgssad / .rgss2a / .rgss3a 需先解包。'}
            </p>
          </Upload.Dragger>
          <Space style={{ marginTop: 12 }} wrap>
            <Button icon={<FolderOpenOutlined />} onClick={() => folderInput.current?.click()}>
              选择游戏文件夹
            </Button>
            <Typography.Text type="secondary" className="small">
              选择文件夹时会自动找出 data / Data / js 目录中的数据文件，并保留相对路径。
            </Typography.Text>
            <input
              ref={folderInput}
              type="file"
              style={{ display: 'none' }}
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </Space>
          {pending.length > 0 && (
            <div className="pending-upload">
              <div className="pending-head">
                <span>
                  待上传 {pending.length} 个文件（{formatSize(pending.reduce((n, p) => n + p.file.size, 0))}）
                </span>
                <Space>
                  <Button size="small" onClick={() => setPending([])} disabled={uploadPct !== null}>
                    清空
                  </Button>
                  <Button size="small" type="primary" onClick={submit} loading={uploadPct !== null}>
                    开始上传
                  </Button>
                </Space>
              </div>
              {uploadPct !== null && <Progress percent={uploadPct} size="small" />}
              <Upload
                fileList={uploadList.slice(0, 50)}
                onRemove={(f) => setPending((p) => p.filter((x) => x.path !== f.uid))}
                showUploadList={{ showRemoveIcon: uploadPct === null }}
              />
              {pending.length > 50 && <Typography.Text type="secondary">… 以及另外 {pending.length - 50} 个文件</Typography.Text>}
            </div>
          )}
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="重新上传同名文件会更新原文：已有译文按键名保留；原文有变化的词条会标记为「有疑问」；脚本、插件参数、备注等危险文本默认隐藏。"
          />
        </Card>
      )}

      {canManage && !!jobs.data?.length && (
        <Card variant="borderless" title="解析任务">
          <List
            size="small"
            dataSource={jobs.data.slice(0, 5)}
            renderItem={(j) => (
              <List.Item>
                <div style={{ width: '100%' }}>
                  <Space>
                    {j.status === 'SUCCEEDED' ? (
                      <CheckCircleFilled style={{ color: '#10b981' }} />
                    ) : j.status === 'FAILED' ? (
                      <CloseCircleFilled style={{ color: '#ef4444' }} />
                    ) : (
                      <LoadingOutlined />
                    )}
                    <span>{j.createdBy?.displayName}</span>
                    <Typography.Text type="secondary">{fromNow(j.createdAt)}</Typography.Text>
                    {(j.status === 'RUNNING' || j.status === 'QUEUED') && (
                      <Progress percent={j.progress} size="small" style={{ width: 160, margin: 0 }} />
                    )}
                  </Space>
                  <JobResult job={j} />
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}

      <Card
        variant="borderless"
        title={`文件（${files.data?.length ?? 0}）`}
        extra={<Input.Search allowClear placeholder="筛选路径" onChange={(e) => setFilter(e.target.value)} style={{ width: 220 }} />}
      >
        <Table<FileItem>
          rowKey="id"
          loading={files.isLoading}
          dataSource={data}
          pagination={data.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={canManage ? '上传游戏数据文件后即可开始翻译' : '还没有文件'} /> }}
          scroll={{ x: 760 }}
          columns={[
            {
              title: '文件',
              dataIndex: 'path',
              render: (path: string, f) => (
                <div>
                  <a onClick={() => nav(`/projects/${pid}/editor?file=${f.id}`)} className="file-path">
                    {path}
                  </a>
                  <div className="muted small">
                    {KIND_LABELS[f.kind] ?? f.kind} · {formatSize(f.size)} · {fromNow(f.updatedAt)}更新
                    {f.warnings.length > 0 && (
                      <Tooltip title={f.warnings.join('\n')}>
                        <Tag color="orange" bordered={false} style={{ marginLeft: 6 }}>
                          {f.warnings.length} 条提示
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ),
            },
            { title: '进度', width: 320, render: (_, f) => <ProgressBar stats={f.stats} height={6} /> },
            {
              title: '操作',
              width: canManage ? 200 : 80,
              render: (_, f) => (
                <Space size={0}>
                  <Tooltip title="翻译">
                    <Button type="text" icon={<TranslationOutlined />} onClick={() => nav(`/projects/${pid}/editor?file=${f.id}`)} />
                  </Tooltip>
                  {canManage && (
                    <>
                      <Tooltip title="上传新版本（更新原文）">
                        <Button
                          type="text"
                          icon={<SwapOutlined />}
                          onClick={() => {
                            replaceTarget.current = f;
                            replaceInput.current?.click();
                          }}
                        />
                      </Tooltip>
                      <Tooltip title="下载原文件">
                        <Button type="text" icon={<DownloadOutlined />} href={`/api/projects/${pid}/files/${f.id}/download`} />
                      </Tooltip>
                      <Popconfirm
                        title="删除文件？"
                        description="该文件的所有词条、译文与历史记录都会被删除，且无法恢复。"
                        okText="删除"
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
            if (f) replace(f);
            e.target.value = '';
          }}
        />
      </Card>
    </Space>
  );
}
