import {
  AppstoreOutlined,
  CloudUploadOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FolderFilled,
  LockOutlined,
  MoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Breadcrumb, Button, Card, Checkbox, Dropdown, Empty, Form, Input, Modal, Popconfirm, Segmented, Skeleton, Space, Switch, Table, Tag, Tooltip, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { PERMISSIONS, attachmentConflict, normalizeAttachmentPath } from '@gametrans/shared';
import { useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { useProject } from '../../../api/project';
import type { Attachment, FileItem } from '../../../api/types';
import { TFn, useT } from '../../../i18n';
import { errorMessage, formatSize, fromNow } from '../../../utils';
import { FileViewer } from './FileViewer';
import { useObjectUrl } from './hooks';
import { ExplorerItem, Folder, ItemKind, buildFolders, contentUrl, findFolder, itemsUnder, toItems } from './model';
import { UploadDialog } from './UploadDialog';

const ROOT_KEY = '/';
const KIND_ICON: Record<ItemKind, React.ReactNode> = {
  image: <FileImageOutlined />,
  encrypted: <FileImageOutlined />,
  audio: <CustomerServiceOutlined />,
  text: <FileTextOutlined />,
  data: <DatabaseOutlined />,
  binary: <FileOutlined />,
};

const stored = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const store = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
};

function treeData(root: Folder, t: TFn): DataNode[] {
  const conv = (f: Folder): DataNode => ({
    key: f.path || ROOT_KEY,
    title: (
      <span className={`folder-title${f.locked ? ' locked' : ''}`}>
        {f.locked && <LockOutlined />} {f.name || t('explorer.root')} <span className="muted small">{f.total}</span>
      </span>
    ),
    children: f.children.map(conv),
  });
  return [conv(root)];
}

/** 图片缩略图（只有能读取内容的管理员才加载） */
function Thumb({ pid, item, load }: { pid: string; item: ExplorerItem; load: boolean }) {
  const media = load && item.source === 'attachment' && (item.kind === 'image' || item.kind === 'encrypted');
  const { url } = useObjectUrl(media ? contentUrl(pid, item) : null, item.kind === 'encrypted');
  return url ? <img src={url} alt={item.name} draggable={false} /> : <span className={`kind-icon kind-${item.kind}`}>{KIND_ICON[item.kind]}</span>;
}

function RenameDialog({ pid, item, dataPaths, attachments, onClose }: { pid: string; item: ExplorerItem; dataPaths: string[]; attachments: Attachment[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [path, setPath] = useState(item.path);
  const [busy, setBusy] = useState(false);
  const norm = normalizeAttachmentPath(path);
  const others = attachments.filter((a) => a.id !== item.id).map((a) => a.path);
  const problem = !norm ? 'invalid' : others.some((p) => p.toLowerCase() === norm.toLowerCase()) ? 'conflict' : attachmentConflict(norm, dataPaths, others);
  const submit = async () => {
    setBusy(true);
    try {
      const a = await api<Attachment>(`/projects/${pid}/attachments/${item.id}`, { method: 'PATCH', body: { path } });
      message.success(t('explorer.renamed', { path: a.path }));
      qc.invalidateQueries({ queryKey: ['attachments', pid] });
      onClose();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={t('explorer.rename')} onCancel={onClose} onOk={submit} confirmLoading={busy} okButtonProps={{ disabled: !!problem || norm === item.path }}>
      <Form layout="vertical">
        <Form.Item label={t('explorer.renameLabel')} validateStatus={problem ? 'error' : undefined} help={problem ? t(`attachments.state.${problem}`) : undefined}>
          <Input value={path} onChange={(e) => setPath(e.target.value)} onPressEnter={() => !problem && submit()} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function AttachmentsPage() {
  const t = useT();
  const { project, has } = useProject();
  const pid = project.id;
  const qc = useQueryClient();
  const { message } = App.useApp();
  const canManage = has(PERMISSIONS.MANAGE_FILES);
  const [showData, setShowData] = useState(() => stored('gt-attach-data', '1') === '1');
  const [view, setView] = useState(() => stored('gt-attach-view', 'grid'));
  const [dir, setDir] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<ExplorerItem | null>(null);
  const [renaming, setRenaming] = useState<ExplorerItem | null>(null);
  const [uploading, setUploading] = useState(false);

  const attachments = useQuery({ queryKey: ['attachments', pid], queryFn: () => api<Attachment[]>(`/projects/${pid}/attachments`) });
  const files = useQuery({ queryKey: ['files', pid], queryFn: () => api<FileItem[]>(`/projects/${pid}/files`) });
  const atts = useMemo(() => attachments.data ?? [], [attachments.data]);
  const dataPaths = useMemo(() => (files.data ?? []).map((f) => f.path), [files.data]);
  const items = useMemo(() => toItems(atts, files.data ?? [], showData), [atts, files.data, showData]);
  const root = useMemo(() => buildFolders(items, dataPaths), [items, dataPaths]);
  const folder = findFolder(root, dir);
  const crumbs = folder.path ? folder.path.split('/') : [];

  const selectable = (it: ExplorerItem) => canManage && it.source === 'attachment';
  const toggle = (keys: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const removeSelected = async () => {
    const ids = items.filter((i) => selected.has(i.key) && i.source === 'attachment').map((i) => i.id);
    try {
      const r = await api<{ deleted: number }>(`/projects/${pid}/attachments/delete`, { method: 'POST', body: { ids } });
      message.success(t('explorer.deleted', { count: r.deleted }));
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['attachments', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const menu = (it: ExplorerItem) => ({
    items: [
      { key: 'open', label: t('explorer.open'), onClick: () => setViewing(it) },
      ...(canManage
        ? [
            { key: 'download', icon: <DownloadOutlined />, label: <a href={`/api${contentUrl(pid, it, it.edited ? 'edited' : undefined)}`}>{t('explorer.download')}</a> },
            ...(it.source === 'attachment'
              ? [
                  { key: 'rename', icon: <EditOutlined />, label: t('explorer.rename'), onClick: () => setRenaming(it) },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    danger: true,
                    label: t('explorer.delete'),
                    onClick: () => {
                      setSelected(new Set([it.key]));
                      void api(`/projects/${pid}/attachments/delete`, { method: 'POST', body: { ids: [it.id] } }).then(() => {
                        message.success(t('explorer.deleted', { count: 1 }));
                        setSelected(new Set());
                        qc.invalidateQueries({ queryKey: ['attachments', pid] });
                      }, (e) => message.error(errorMessage(e)));
                    },
                  },
                ]
              : []),
          ]
        : []),
    ],
  });

  const tags = (it: ExplorerItem) => (
    <>
      {it.source === 'data' && (
        <Tooltip title={t('explorer.dataLocked')}>
          <Tag bordered={false} icon={<LockOutlined />} className="data-tag">
            {t('explorer.dataFile')}
          </Tag>
        </Tooltip>
      )}
      {it.edited && (
        <Tag color="orange" bordered={false}>
          {t('explorer.edited')}
        </Tag>
      )}
    </>
  );

  const underCurrent = itemsUnder(folder).filter(selectable).map((i) => i.key);
  const allChecked = underCurrent.length > 0 && underCurrent.every((k) => selected.has(k));
  const selCount = items.filter((i) => selected.has(i.key)).length;
  const empty = !folder.children.length && !folder.items.length;

  const grid = (
    <div className="img-grid explorer-grid">
      {folder.children.map((c) => {
        const keys = itemsUnder(c).filter(selectable).map((i) => i.key);
        const all = keys.length > 0 && keys.every((k) => selected.has(k));
        return (
          <div key={c.path} className={`img-tile folder-tile${c.locked ? ' locked' : ''}`} onDoubleClick={() => setDir(c.path)} onClick={() => setDir(c.path)}>
            {keys.length > 0 && (
              <Checkbox className="tile-check" checked={all} indeterminate={!all && keys.some((k) => selected.has(k))} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(keys, e.target.checked)} />
            )}
            <div className="tile-thumb">
              <FolderFilled className="folder-icon" />
              {c.locked && <LockOutlined className="folder-lock" />}
            </div>
            <div className="tile-name" title={c.name}>
              {c.name}
            </div>
            <div className="tile-meta">{t('explorer.items', { count: c.total })}</div>
          </div>
        );
      })}
      {folder.items.map((it) => (
        <div key={it.key} className={`img-tile explorer-item${it.source === 'data' ? ' is-data' : ''}${selected.has(it.key) ? ' checked' : ''}`} onClick={() => setViewing(it)} data-path={it.path}>
          {selectable(it) && <Checkbox className="tile-check" checked={selected.has(it.key)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle([it.key], e.target.checked)} />}
          <Dropdown menu={menu(it)} trigger={['click']}>
            <Button className="tile-more" size="small" type="text" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
          </Dropdown>
          <div className="tile-thumb">
            <Thumb pid={pid} item={it} load={canManage} />
          </div>
          <div className="tile-name" title={it.name}>
            {it.name}
          </div>
          <div className="tile-meta">
            {formatSize(it.size)} {tags(it)}
          </div>
        </div>
      ))}
    </div>
  );

  const list = (
    <Table<ExplorerItem>
      rowKey="key"
      size="small"
      pagination={false}
      dataSource={folder.items}
      rowClassName={(it) => (it.source === 'data' ? 'is-data' : '')}
      rowSelection={canManage ? { selectedRowKeys: [...selected], getCheckboxProps: (it) => ({ disabled: !selectable(it) }), onChange: (keys) => setSelected(new Set(keys as string[])) } : undefined}
      onRow={(it) => ({ onDoubleClick: () => setViewing(it) })}
      columns={[
        {
          title: t('explorer.col.name'),
          render: (_, it) => (
            <a className="file-path" onClick={() => setViewing(it)}>
              {KIND_ICON[it.kind]} {it.name}
            </a>
          ),
        },
        { title: t('explorer.col.size'), width: 100, render: (_, it) => formatSize(it.size) },
        { title: t('explorer.col.status'), width: 200, render: (_, it) => tags(it) },
        { title: t('explorer.col.updated'), width: 180, render: (_, it) => <span className="muted small">{it.by?.displayName} {fromNow(it.updatedAt)}</span> },
        {
          title: '',
          width: 48,
          render: (_, it) => (
            <Dropdown menu={menu(it)} trigger={['click']}>
              <Button size="small" type="text" icon={<MoreOutlined />} />
            </Dropdown>
          ),
        },
      ]}
      locale={{ emptyText: folder.children.length ? ' ' : t('explorer.empty') }}
    />
  );

  return (
    <div className="explorer">
      <Card variant="borderless" className="tool-bar">
        <Space wrap size={12}>
          {canManage && (
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploading(true)}>
              {t('explorer.upload')}
            </Button>
          )}
          {canManage && (
            <Popconfirm title={t('explorer.deleteConfirm', { count: selCount })} okButtonProps={{ danger: true }} okText={t('common.delete')} onConfirm={removeSelected} disabled={!selCount}>
              <Button danger icon={<DeleteOutlined />} disabled={!selCount}>
                {t('explorer.deleteSelected', { count: selCount })}
              </Button>
            </Popconfirm>
          )}
          <Space size={6}>
            <Switch
              size="small"
              checked={showData}
              onChange={(v) => {
                setShowData(v);
                store('gt-attach-data', v ? '1' : '0');
              }}
              aria-label={t('explorer.showData')}
            />
            <span>{t('explorer.showData')}</span>
          </Space>
          <Segmented
            value={view}
            onChange={(v) => {
              setView(String(v));
              store('gt-attach-view', String(v));
            }}
            options={[
              { value: 'grid', icon: <AppstoreOutlined />, label: t('explorer.view.grid') },
              { value: 'list', icon: <UnorderedListOutlined />, label: t('explorer.view.list') },
            ]}
          />
        </Space>
        {!canManage && <Typography.Paragraph type="secondary" className="small" style={{ margin: '12px 0 0' }}>{t('explorer.readOnly')}</Typography.Paragraph>}
      </Card>

      {attachments.isLoading || files.isLoading ? (
        <Card variant="borderless">
          <Skeleton active />
        </Card>
      ) : !root.total ? (
        <Card variant="borderless">
          <Empty description={t('explorer.emptyAll')}>
            {canManage && (
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploading(true)}>
                {t('explorer.upload')}
              </Button>
            )}
          </Empty>
        </Card>
      ) : (
        <div className="tool-split">
          <Card variant="borderless" className="tool-tree" size="small">
            <Tree.DirectoryTree
              key={`${showData}`}
              treeData={treeData(root, t)}
              selectedKeys={[folder.path || ROOT_KEY]}
              defaultExpandAll
              expandAction={false}
              onSelect={(keys) => {
                if (keys.length) setDir(keys[0] === ROOT_KEY ? '' : String(keys[0]));
              }}
            />
          </Card>
          <Card
            variant="borderless"
            className="tool-main"
            size="small"
            title={
              <Breadcrumb
                items={[
                  { title: <a onClick={() => setDir('')}>{t('explorer.root')}</a> },
                  ...crumbs.map((c, i) => {
                    const path = crumbs.slice(0, i + 1).join('/');
                    return { title: i === crumbs.length - 1 ? c : <a onClick={() => setDir(path)}>{c}</a> };
                  }),
                ]}
              />
            }
            extra={
              canManage &&
              underCurrent.length > 0 && (
                <Checkbox checked={allChecked} indeterminate={!allChecked && underCurrent.some((k) => selected.has(k))} onChange={(e) => toggle(underCurrent, e.target.checked)}>
                  {t('img.selectAll')}
                </Checkbox>
              )
            }
          >
            {view === 'grid' ? grid : list}
            {view === 'grid' && empty && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('explorer.empty')} />}
          </Card>
        </div>
      )}

      {viewing && <FileViewer pid={pid} item={items.find((i) => i.key === viewing.key) ?? viewing} canManage={canManage} onClose={() => setViewing(null)} />}
      {renaming && <RenameDialog pid={pid} item={renaming} dataPaths={dataPaths} attachments={atts} onClose={() => setRenaming(null)} />}
      {uploading && <UploadDialog pid={pid} dataPaths={dataPaths} attachments={atts} initialDir={folder.path} onClose={() => setUploading(false)} />}
    </div>
  );
}
