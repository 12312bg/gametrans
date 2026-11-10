import { CloudUploadOutlined, DeleteOutlined, FolderOpenOutlined, LockOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Collapse, Form, Input, Modal, Progress, Space, Spin, Table, Tag, Tooltip, TreeSelect, Typography, Upload } from 'antd';
import { attachmentConflict, isImagePath, joinPath, normalizeAttachmentPath, parentDirs } from '@gametrans/shared';
import { ReactNode, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { upload } from '../../../api/client';
import type { Attachment } from '../../../api/types';
import { languageOf } from '../../../components/code/setup';
import type { DiffMode } from '../../../components/code/DiffView';
import { TFn, useT } from '../../../i18n';
import { useAuth } from '../../../providers/AuthProvider';
import { errorMessage, formatSize } from '../../../utils';
import { loadText, useObjectUrl } from './hooks';

const DiffView = lazy(() => import('../../../components/code/DiffView'));

interface DirNode {
  value: string;
  title: ReactNode;
  label: string;
  children: DirNode[];
}

/** 目录树：数据文件所在目录锁定，可以在任意目录下新建子目录 */
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
        <Tooltip title={t('explorer.lockedDir')}>
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
  return [{ value: '', label: t('explorer.root'), title: t('explorer.root'), children: roots }];
}

type RowState = 'new' | 'overwrite' | 'locked' | 'conflict' | 'invalid' | 'tooLarge';
const STATE_COLOR: Record<RowState, string> = { new: 'green', overwrite: 'orange', locked: 'red', conflict: 'red', invalid: 'red', tooLarge: 'red' };
const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
const utf8 = new TextDecoder('utf-8', { fatal: true });

interface Row {
  key: string;
  path: string;
  file: File;
  state: RowState;
  existing?: Attachment;
}

/** 覆盖前的对比：文本逐行对比，图片并排显示，其他格式只比较大小 */
function OverwriteDiff({ pid, row }: { pid: string; row: Row }) {
  const t = useT();
  const [texts, setTexts] = useState<{ before: string | null; after: string | null } | null>(null);
  const [mode, setMode] = useState<DiffMode>('split');
  const image = isImagePath(row.path);
  const before = useObjectUrl(image ? `/projects/${pid}/attachments/${row.existing!.id}/download?version=original` : null);
  const after = useMemo(() => (image ? URL.createObjectURL(row.file) : null), [image, row.file]);
  useEffect(() => () => void (after && URL.revokeObjectURL(after)), [after]);

  useEffect(() => {
    if (image) return;
    let alive = true;
    (async () => {
      const old = await loadText(`/projects/${pid}/attachments/${row.existing!.id}/download?version=original`);
      let next: string | null;
      try {
        next = utf8.decode(await row.file.arrayBuffer());
      } catch {
        next = null;
      }
      if (alive) setTexts({ before: old, after: next });
    })();
    return () => {
      alive = false;
    };
  }, [pid, row, image]);

  if (image) {
    return (
      <div className="overwrite-images">
        <figure>
          <figcaption>{t('overwrite.old')}</figcaption>
          {before.url ? <img src={before.url} alt="" /> : <Spin />}
        </figure>
        <figure>
          <figcaption>{t('overwrite.new')}</figcaption>
          {after && <img src={after} alt="" />}
        </figure>
      </div>
    );
  }
  if (!texts) return <Spin />;
  if (texts.before === null || texts.after === null) {
    return <Typography.Text type="secondary">{t('overwrite.binary', { before: formatSize(row.existing!.size), after: formatSize(row.file.size) })}</Typography.Text>;
  }
  if (texts.before === texts.after) return <Typography.Text type="secondary">{t('overwrite.same')}</Typography.Text>;
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Space>
        <Button size="small" type={mode === 'split' ? 'primary' : 'default'} onClick={() => setMode('split')}>
          {t('viewer.diff.split')}
        </Button>
        <Button size="small" type={mode === 'unified' ? 'primary' : 'default'} onClick={() => setMode('unified')}>
          {t('viewer.diff.unified')}
        </Button>
      </Space>
      <Suspense fallback={<Spin />}>
        <DiffView original={texts.before} modified={texts.after} mode={mode} language={languageOf(row.path)} height={320} />
      </Suspense>
    </Space>
  );
}

interface Props {
  pid: string;
  dataPaths: string[];
  attachments: Attachment[];
  initialDir: string;
  onClose: () => void;
}

export function UploadDialog({ pid, dataPaths, attachments, initialDir, onClose }: Props) {
  const t = useT();
  const { site } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [dir, setDir] = useState(initialDir);
  const [subdir, setSubdir] = useState('');
  const [picked, setPicked] = useState<{ file: File; rel: string }[]>([]);
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState<number | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const tree = useMemo(() => dirTree(dataPaths, attachments.map((a) => a.path), t), [dataPaths, attachments, t]);
  const limit = site?.uploadLimitMb;

  const sub = subdir.trim() ? normalizeAttachmentPath(subdir) : '';
  const target = sub === null ? null : joinPath(dir, sub);
  const rows: Row[] = picked.map((p, i) => {
    const path = target === null ? null : normalizeAttachmentPath(joinPath(target, p.rel));
    let state: RowState = 'new';
    let existing: Attachment | undefined;
    if (path === null) state = 'invalid';
    else if (limit && p.file.size > limit * 1024 * 1024) state = 'tooLarge';
    else {
      const lower = path.toLowerCase();
      const others = [...attachments.map((a) => a.path), ...picked.filter((_, j) => j !== i).map((q) => joinPath(target!, q.rel))];
      const hit = picked.some((q, j) => j !== i && joinPath(target!, q.rel).toLowerCase() === lower) ? 'conflict' : attachmentConflict(path, dataPaths, others);
      existing = attachments.find((a) => a.path.toLowerCase() === lower);
      if (hit) state = hit;
      else if (existing) state = 'overwrite';
    }
    return { key: `${i}`, path: path ?? joinPath(target ?? dir, p.rel), file: p.file, state, existing };
  });
  const bad = rows.filter((r) => STATE_COLOR[r.state] === 'red').length;
  const overwrites = rows.filter((r) => r.state === 'overwrite');

  const add = (files: File[]) => setPicked((prev) => [...prev, ...files.map((file) => ({ file, rel: relPath(file) }))]);

  const submit = async () => {
    if (!picked.length || bad || target === null) return;
    if (step === 'pick' && overwrites.length) return setStep('review');
    const form = new FormData();
    for (const p of picked) form.append('files', p.file, p.file.name);
    form.append('dir', target);
    form.append('paths', JSON.stringify(picked.map((p) => p.rel)));
    form.append('keepEdits', JSON.stringify(overwrites.filter((r) => keep.has(r.path)).map((r) => r.path)));
    setPct(0);
    try {
      const r = await upload<{ created: number; updated: number }>(`/projects/${pid}/attachments`, form, setPct);
      message.success(t('attachments.uploaded', r));
      qc.invalidateQueries({ queryKey: ['attachments', pid] });
      onClose();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setPct(null);
    }
  };

  const review = (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type="warning" showIcon message={t('overwrite.desc', { count: overwrites.length })} />
      <Collapse
        className="overwrite-list"
        items={overwrites.map((r) => ({
          key: r.key,
          label: (
            <Space wrap>
              <span className="file-path">{r.path}</span>
              <Typography.Text type="secondary" className="small">
                {formatSize(r.existing!.size)} → {formatSize(r.file.size)}
              </Typography.Text>
              {r.existing!.editedAt && (
                <Tag color="orange" bordered={false}>
                  {t('explorer.edited')}
                </Tag>
              )}
            </Space>
          ),
          extra: r.existing!.editedAt ? (
            <Tooltip title={t('overwrite.keepEditHint')}>
              <Checkbox
                checked={keep.has(r.path)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  setKeep((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(r.path);
                    else next.delete(r.path);
                    return next;
                  })
                }
              >
                {t('overwrite.keepEdit')}
              </Checkbox>
            </Tooltip>
          ) : undefined,
          children: <OverwriteDiff pid={pid} row={r} />,
        }))}
      />
    </Space>
  );

  const picker = (
    <>
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
            { title: t('attachments.col.size'), width: 90, render: (_, r) => formatSize(r.file.size) },
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
    </>
  );

  return (
    <Modal
      open
      width={step === 'review' ? 1100 : 720}
      title={t(step === 'review' ? 'overwrite.title' : 'attachments.upload')}
      onCancel={onClose}
      footer={[
        step === 'review' && (
          <Button key="back" onClick={() => setStep('pick')} disabled={pct !== null}>
            {t('overwrite.back')}
          </Button>
        ),
        <Button key="cancel" onClick={onClose} disabled={pct !== null}>
          {t('common.cancel')}
        </Button>,
        <Button key="ok" type="primary" loading={pct !== null} disabled={!picked.length || bad > 0 || target === null} onClick={submit}>
          {t(step === 'review' ? 'overwrite.confirm' : 'attachments.upload')}
        </Button>,
      ]}
      destroyOnHidden
    >
      {step === 'review' ? review : picker}
      {pct !== null && <Progress percent={pct} size="small" />}
    </Modal>
  );
}
