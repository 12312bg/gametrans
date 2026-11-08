import { CloudUploadOutlined, DeleteOutlined, DownloadOutlined, FolderOpenOutlined, LockOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Empty, Form, Input, Modal, Popconfirm, Progress, Space, Table, Tag, Tooltip, TreeSelect, Typography, Upload } from 'antd';
import { attachmentConflict, joinPath, normalizeAttachmentPath, parentDirs } from '@gametrans/shared';
import { ReactNode, useMemo, useRef, useState } from 'react';
import { api, upload } from '../../../api/client';
import { useProject } from '../../../api/project';
import type { Attachment } from '../../../api/types';
import { TFn, useT } from '../../../i18n';
import { useAuth } from '../../../providers/AuthProvider';
import { errorMessage, formatSize, fromNow } from '../../../utils';

interface DirNode {
  value: string;
  title: ReactNode;
  label: string;
  children: DirNode[];
}

/** 目录树：数据文件所在目录锁定，附件所在目录与游戏根目录可用于新建子目录 */
function dirTree(dataPaths: string[], attachments: string[], t: TFn): DirNode[] {
  const locked = new Set(dataPaths.flatMap(parentDirs));
  const dirs = [...new Set([...locked, ...attachments.flatMap(parentDirs)])].sort();
  const nodes = new Map<string, DirNode>();
  const roots: DirNode[] = [];
  for (const d of dirs) {
    const name = d.split('/').pop()!;
    const node: DirNode = {
      value: d,
      label: d,
      title: locked.has(d) ? (
        <Tooltip title={t('attachments.lockedDir')}>
          <span>
            <LockOutlined className="muted" /> {name}
          </span>
        </Tooltip>
      ) : (
        name
      ),
      children: [],
    };
    nodes.set(d, node);
    const parent = d.includes('/') ? nodes.get(d.slice(0, d.lastIndexOf('/'))) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return [{ value: '', label: t('attachments.root'), title: t('attachments.root'), children: roots }];
}

type RowState = 'new' | 'overwrite' | 'locked' | 'conflict' | 'invalid' | 'tooLarge';
const STATE_COLOR: Record<RowState, string> = { new: 'green', overwrite: 'orange', locked: 'red', conflict: 'red', invalid: 'red', tooLarge: 'red' };
const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

function UploadModal({ dataPaths, attachments, onClose }: { dataPaths: string[]; attachments: Attachment[]; onClose: () => void }) {
  const t = useT();
  const { project } = useProject();
  const { site } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [dir, setDir] = useState('');
  const [subdir, setSubdir] = useState('');
  const [picked, setPicked] = useState<{ file: File; rel: string }[]>([]);
  const [pct, setPct] = useState<number | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const tree = useMemo(() => dirTree(dataPaths, attachments.map((a) => a.path), t), [dataPaths, attachments, t]);
  const limit = site?.uploadLimitMb;

  const sub = subdir.trim() ? normalizeAttachmentPath(subdir) : '';
  const target = sub === null ? null : joinPath(dir, sub);
  const rows = picked.map((p, i) => {
    const path = target === null ? null : normalizeAttachmentPath(joinPath(target, p.rel));
    let state: RowState = 'new';
    if (path === null) state = 'invalid';
    else if (limit && p.file.size > limit * 1024 * 1024) state = 'tooLarge';
    else {
      const others = [...attachments.map((a) => a.path), ...picked.filter((_, j) => j !== i).map((q) => joinPath(target!, q.rel))];
      const lower = path.toLowerCase();
      const hit = picked.some((q, j) => j !== i && joinPath(target!, q.rel).toLowerCase() === lower) ? 'conflict' : attachmentConflict(path, dataPaths, others);
      if (hit) state = hit;
      else if (attachments.some((a) => a.path.toLowerCase() === lower)) state = 'overwrite';
    }
    return { key: `${i}`, path: path ?? joinPath(target ?? dir, p.rel), size: p.file.size, state };
  });
  const bad = rows.filter((r) => STATE_COLOR[r.state] === 'red').length;

  const add = (files: File[]) => setPicked((prev) => [...prev, ...files.map((file) => ({ file, rel: relPath(file) }))]);

  const submit = async () => {
    if (!picked.length || bad || target === null) return;
    const form = new FormData();
    for (const p of picked) form.append('files', p.file, p.file.name);
    form.append('dir', target);
    form.append('paths', JSON.stringify(picked.map((p) => p.rel)));
    setPct(0);
    try {
      const r = await upload<{ created: number; updated: number }>(`/projects/${project.id}/attachments`, form, setPct);
      message.success(t('attachments.uploaded', r));
      qc.invalidateQueries({ queryKey: ['attachments', project.id] });
      onClose();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setPct(null);
    }
  };

  return (
    <Modal
      open
      width={720}
      title={t('attachments.upload')}
      onCancel={onClose}
      onOk={submit}
      okText={t('attachments.upload')}
      okButtonProps={{ disabled: !picked.length || bad > 0 || target === null }}
      confirmLoading={pct !== null}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Space size={16} wrap style={{ width: '100%' }} className="attach-target">
          <Form.Item label={t('attachments.dir')} style={{ minWidth: 260 }}>
            <TreeSelect value={dir} onChange={setDir} treeData={tree} treeDefaultExpandAll treeNodeLabelProp="label" showSearch />
          </Form.Item>
          <Form.Item
            label={t('attachments.subdir')}
            style={{ minWidth: 240 }}
            validateStatus={sub === null ? 'error' : undefined}
            help={sub === null ? t('attachments.state.invalid') : undefined}
          >
            <Input value={subdir} onChange={(e) => setSubdir(e.target.value)} placeholder={t('attachments.subdirPlaceholder')} />
          </Form.Item>
        </Space>
      </Form>
      <Upload.Dragger
        multiple
        showUploadList={false}
        beforeUpload={(f, list) => {
          if (f === list[0]) add(list as unknown as File[]);
          return false;
        }}
      >
        <p className="ant-upload-drag-icon">
          <CloudUploadOutlined />
        </p>
        <p className="ant-upload-text">{t('attachments.pick')}</p>
      </Upload.Dragger>
      <Button icon={<FolderOpenOutlined />} style={{ marginTop: 8 }} onClick={() => folderInput.current?.click()}>
        {t('attachments.pickFolder')}
      </Button>
      <input
        ref={folderInput}
        type="file"
        multiple
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {rows.length > 0 && (
        <Table
          className="attach-rows"
          size="small"
          style={{ marginTop: 12 }}
          pagination={false}
          scroll={{ y: 240 }}
          dataSource={rows}
          columns={[
            { title: t('attachments.col.path'), dataIndex: 'path', render: (p: string) => <span className="file-path">{p}</span> },
            { title: t('attachments.col.size'), dataIndex: 'size', width: 90, render: (n: number) => formatSize(n) },
            {
              title: '',
              width: 170,
              render: (_, r) => (
                <Space size={4}>
                  <Tag bordered={false} color={STATE_COLOR[r.state]}>
                    {t(`attachments.state.${r.state}`, { limit })}
                  </Tag>
                  <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => setPicked((p) => p.filter((_, i) => `${i}` !== r.key))} />
                </Space>
              ),
            },
          ]}
        />
      )}
      {bad > 0 && <Alert style={{ marginTop: 12 }} type="error" showIcon message={t('attachments.hasErrors', { count: bad })} />}
      {pct !== null && <Progress percent={pct} size="small" />}
    </Modal>
  );
}

export function AttachmentsCard({ canManage, dataPaths }: { canManage: boolean; dataPaths: Set<string> }) {
  const t = useT();
  const { project } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['attachments', pid], queryFn: () => api<Attachment[]>(`/projects/${pid}/attachments`) });
  const items = list.data ?? [];

  const remove = async (a: Attachment) => {
    try {
      await api(`/projects/${pid}/attachments/${a.id}`, { method: 'DELETE' });
      message.success(t('attachments.deleted'));
      qc.invalidateQueries({ queryKey: ['attachments', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <Card
      variant="borderless"
      className="attachments-card"
      title={
        <Space>
          <PaperClipOutlined />
          {t('attachments.title', { count: items.length })}
        </Space>
      }
      extra={
        canManage && (
          <Button type="primary" ghost icon={<CloudUploadOutlined />} onClick={() => setOpen(true)}>
            {t('attachments.upload')}
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">{t('attachments.intro')}</Typography.Paragraph>
      <Table<Attachment>
        rowKey="id"
        size="small"
        loading={list.isLoading}
        dataSource={items}
        pagination={items.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
        scroll={{ x: 640 }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('attachments.empty')} /> }}
        columns={[
          {
            title: t('attachments.col.path'),
            dataIndex: 'path',
            render: (p: string) => {
              const i = p.lastIndexOf('/');
              return (
                <span className="file-path">
                  <span className="muted">{p.slice(0, i + 1)}</span>
                  {p.slice(i + 1)}
                </span>
              );
            },
          },
          { title: t('attachments.col.size'), dataIndex: 'size', width: 100, render: (n: number) => formatSize(n) },
          {
            title: t('attachments.col.updated'),
            width: 180,
            render: (_, a) => (
              <span className="muted small">
                {a.createdBy?.displayName} · {fromNow(a.updatedAt)}
              </span>
            ),
          },
          ...(canManage
            ? [
                {
                  title: t('attachments.col.actions'),
                  width: 110,
                  render: (_: unknown, a: Attachment) => (
                    <Space size={0}>
                      <Tooltip title={t('attachments.download')}>
                        <Button type="text" icon={<DownloadOutlined />} href={`/api/projects/${pid}/attachments/${a.id}/download`} />
                      </Tooltip>
                      <Popconfirm title={t('attachments.deleteConfirm', { path: a.path })} okText={t('common.delete')} okButtonProps={{ danger: true }} onConfirm={() => remove(a)}>
                        <Button type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      {open && <UploadModal dataPaths={[...dataPaths]} attachments={items} onClose={() => setOpen(false)} />}
    </Card>
  );
}
