import { DownloadOutlined, LockOutlined, RollbackOutlined, SaveOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Empty, Modal, Popconfirm, Segmented, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { PREEDIT_MAX_BYTES } from '@gametrans/shared';
import { Suspense, lazy, useState } from 'react';
import { ApiError, api } from '../../../api/client';
import type { FileEdit } from '../../../api/types';
import { languageOf } from '../../../components/code/setup';
import type { DiffMode } from '../../../components/code/DiffView';
import { useT } from '../../../i18n';
import { errorMessage, formatSize, fromNow } from '../../../utils';
import { useObjectUrl, loadText } from './hooks';
import { ExplorerItem, contentUrl } from './model';

const CodeEditor = lazy(() => import('../../../components/code/CodeEditor'));
const DiffView = lazy(() => import('../../../components/code/DiffView'));

const Loading = () => (
  <div className="center-spin">
    <Spin />
  </div>
);

interface TextState {
  /** 能否预编辑（数据文件需为 MV/MZ 的 JSON / plugins.js，附件需为 UTF-8 文本） */
  editable: boolean;
  original: string | null;
  edited: string | null;
  /** 没有生效的预编辑变更数（数据文件的原文件已更新） */
  conflicts?: number;
  reason?: 'binaryData' | 'notText' | 'tooLarge';
}

/** 读取文本内容：附件取原件与预编辑后的版本；数据文件取易读格式的 JSON */
function useTextState(pid: string, item: ExplorerItem, enabled: boolean) {
  return useQuery<TextState>({
    queryKey: ['viewer-text', item.key, item.updatedAt],
    placeholderData: keepPreviousData,
    enabled: enabled && (item.kind === 'text' || item.source === 'data'),
    queryFn: async () => {
      if (item.source === 'data') {
        const e = await api<FileEdit>(`/projects/${pid}/files/${item.id}/edit`);
        return e.editable ? { editable: true, original: e.original, edited: e.edited, conflicts: e.conflicts } : { editable: false, original: null, edited: null, reason: 'binaryData' };
      }
      if ((item.attachment?.size ?? item.size) > PREEDIT_MAX_BYTES) return { editable: false, original: null, edited: null, reason: 'tooLarge' };
      const original = await loadText(contentUrl(pid, item, 'original'));
      if (original === null) return { editable: false, original: null, edited: null, reason: 'notText' };
      const edited = item.edited ? await loadText(contentUrl(pid, item, 'edited')) : null;
      return { editable: true, original, edited };
    },
  });
}

function MediaPreview({ pid, item }: { pid: string; item: ExplorerItem }) {
  const t = useT();
  const { url, error } = useObjectUrl(contentUrl(pid, item), item.kind === 'encrypted');
  if (error) return <Alert type="error" showIcon message={t(`img.error.${error}`)} />;
  if (!url) return <Loading />;
  return item.kind === 'audio' ? <audio controls src={url} className="viewer-audio" /> : (
    <div className="viewer-image">
      <img src={url} alt={item.name} />
    </div>
  );
}

export function FileViewer({ pid, item, canManage, onClose }: { pid: string; item: ExplorerItem; canManage: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const text = useTextState(pid, item, canManage);
  const [tab, setTab] = useState('preview');
  const [version, setVersion] = useState<'edited' | 'original'>(item.edited ? 'edited' : 'original');
  const [draft, setDraft] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>('split');
  const [stats, setStats] = useState<{ added: number; removed: number; chunks: number } | null>(null);
  const [touched, setTouched] = useState<{ key: string; before?: string; after?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const s = text.data;
  const base = s ? (s.edited ?? s.original ?? '') : '';
  const dirty = draft !== null && draft !== base;
  const editUrl = item.source === 'attachment' ? `/projects/${pid}/attachments/${item.id}/edit` : `/projects/${pid}/files/${item.id}/edit`;
  const language = languageOf(item.path);

  const refresh = () => {
    for (const key of ['attachments', 'files']) qc.invalidateQueries({ queryKey: [key, pid] });
    qc.invalidateQueries({ queryKey: ['viewer-text', item.key] });
  };

  const save = async () => {
    if (draft === null) return;
    setBusy(true);
    setTouched(null);
    try {
      await api(editUrl, { method: 'PUT', body: { content: draft } });
      message.success(t('viewer.saved'));
      setDraft(null);
      refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PREEDIT_TOUCHES_ENTRIES') setTouched((e.data as { touched?: typeof touched }).touched ?? []);
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    setBusy(true);
    try {
      await api(editUrl, { method: 'DELETE' });
      message.success(t('viewer.reverted'));
      setDraft(null);
      setTouched(null);
      setVersion('original');
      refresh();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reasonAlert = s?.reason && <Alert type="info" showIcon message={t(`viewer.${s.reason}`)} />;
  const isText = item.kind === 'text' || item.source === 'data';
  const modified = dirty ? draft : (s?.edited ?? null);

  const preview = !canManage ? (
    <Alert type="info" showIcon message={t('explorer.readOnly')} />
  ) : isText ? (
    text.isLoading ? (
      <Loading />
    ) : reasonAlert || (
      <Space direction="vertical" style={{ width: '100%' }}>
        {s?.edited !== null && (
          <Segmented
            value={version}
            onChange={(v) => setVersion(v as typeof version)}
            options={[
              { value: 'edited', label: t('viewer.version.edited') },
              { value: 'original', label: t('viewer.version.original') },
            ]}
          />
        )}
        <Suspense fallback={<Loading />}>
          <CodeEditor key={version} value={(version === 'edited' ? s?.edited : s?.original) ?? s?.original ?? ''} readOnly language={language} height="60vh" />
        </Suspense>
      </Space>
    )
  ) : item.kind === 'image' || item.kind === 'encrypted' || item.kind === 'audio' ? (
    <MediaPreview pid={pid} item={item} />
  ) : (
    <Alert type="info" showIcon message={t(item.source === 'data' ? 'viewer.binaryData' : 'viewer.binary')} />
  );

  const editor = s?.editable && (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type="info" showIcon message={t(item.source === 'data' ? 'viewer.editHintData' : 'viewer.editHint')} />
      {touched && (
        <Alert
          type="error"
          showIcon
          message={t('viewer.touched')}
          description={
            <ul className="touched-list">
              {touched.map((x) => (
                <li key={x.key}>
                  <code>{x.key}</code> {x.before !== undefined && <mark className="diff-del">{x.before}</mark>} {x.after !== undefined && <mark className="diff-ins">{x.after}</mark>}
                </li>
              ))}
            </ul>
          }
        />
      )}
      <Suspense fallback={<Loading />}>
        <CodeEditor value={draft ?? base} onChange={setDraft} language={language} height="56vh" />
      </Suspense>
      <Space wrap>
        <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={busy} onClick={save}>
          {t('viewer.save')}
        </Button>
        {dirty && <Button onClick={() => (setDraft(null), setTouched(null))}>{t('viewer.discard')}</Button>}
        {s.edited !== null && (
          <Popconfirm title={t('viewer.revertConfirm')} onConfirm={revert}>
            <Button danger icon={<RollbackOutlined />} disabled={busy}>
              {t('viewer.revert')}
            </Button>
          </Popconfirm>
        )}
        {dirty && <Typography.Text type="warning">{t('viewer.unsaved')}</Typography.Text>}
      </Space>
    </Space>
  );

  const diff =
    s && modified !== null ? (
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space wrap>
          <Segmented
            value={diffMode}
            onChange={(v) => setDiffMode(v as DiffMode)}
            options={[
              { value: 'split', label: t('viewer.diff.split') },
              { value: 'unified', label: t('viewer.diff.unified') },
            ]}
          />
          <Typography.Text type="secondary" className="diff-stats">
            {stats && (stats.chunks ? t('viewer.diff.stats', stats) : t('viewer.diff.none'))}
          </Typography.Text>
          {dirty && <Tag color="orange">{t('viewer.diffDraft')}</Tag>}
        </Space>
        <Suspense fallback={<Loading />}>
          <DiffView original={s.original ?? ''} modified={modified} mode={diffMode} language={language} height="58vh" onStats={setStats} />
        </Suspense>
      </Space>
    ) : (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('viewer.noEdit')} />
    );

  const tabs = [
    { key: 'preview', label: t('viewer.tab.preview'), children: preview },
    ...(canManage && s?.editable ? [{ key: 'edit', label: t('viewer.tab.edit'), children: editor }, { key: 'diff', label: t('viewer.tab.diff'), children: diff }] : []),
  ];

  return (
    <Modal
      open
      width="min(1280px, 96vw)"
      className="file-viewer"
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      title={
        <Space wrap size={8}>
          <span className="file-path">{item.path}</span>
          {item.source === 'data' && (
            <Tag icon={<LockOutlined />} bordered={false}>
              {t('explorer.dataFile')}
            </Tag>
          )}
          {item.edited && (
            <Tag color="orange" bordered={false}>
              {t('explorer.edited')}
            </Tag>
          )}
          <Typography.Text type="secondary" className="small">
            {formatSize(item.size)}
            {item.edited && item.by && ` · ${t('viewer.editedBy', { name: item.by.displayName, time: fromNow(item.updatedAt) })}`}
          </Typography.Text>
          {canManage && (
            <Button size="small" type="text" icon={<DownloadOutlined />} href={`/api${contentUrl(pid, item, item.edited ? 'edited' : undefined)}`}>
              {t('explorer.download')}
            </Button>
          )}
        </Space>
      }
    >
      {canManage && !!s?.conflicts && <Alert type="warning" showIcon className="viewer-conflicts" message={t('viewer.conflicts', { count: s.conflicts })} />}
      <Tabs activeKey={tabs.some((x) => x.key === tab) ? tab : 'preview'} onChange={setTab} items={tabs} destroyOnHidden />
    </Modal>
  );
}
