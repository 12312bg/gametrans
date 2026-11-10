import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Checkbox, Form, Input, Modal, Radio, Space, Table, Typography } from 'antd';
import { ReplaceSegment, Stage, buildMatcher, replaceWithSegments } from '@gametrans/shared';
import { useState } from 'react';
import { api } from '../../../api/client';
import { StageTag } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { errorMessage } from '../../../utils';
import type { EntryFilter } from './EditorToolbar';

interface PreviewItem {
  id: string;
  key: string;
  stage: Stage;
  file: { path: string };
  contextText: string;
  before: string;
  after: string;
}

interface Preview {
  affected: number;
  skipped: number;
  occurrences: number;
  items: PreviewItem[];
}

const Segments = ({ parts, kind }: { parts: ReplaceSegment[]; kind: 'del' | 'ins' }) => (
  <span className="pre-wrap">
    {parts.map((p, i) => (p.changed ? <mark key={i} className={`diff-${kind}`}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
  </span>
);

/** 批量替换译文：先预览再替换，状态不变，可在历史中回滚 */
export function ReplaceModal({ pid, filter, onClose }: { pid: string; filter: EntryFilter; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scope, setScope] = useState<'filter' | 'project'>('filter');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const opts = { find, replace, regex, caseSensitive };
  const matcher = find ? buildMatcher(opts) : null;
  const body = { ...opts, filter: scope === 'filter' ? filter : undefined };
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api<Preview>(`/projects/${pid}/entries/replace`, { method: 'POST', body: { ...body, dryRun } });
      if (dryRun) return setPreview(r);
      message.success(r.skipped ? t('replace.doneSkipped', { count: r.affected, skipped: r.skipped }) : t('replace.done', { count: r.affected }));
      for (const key of ['entries', 'entry', 'history']) qc.invalidateQueries({ queryKey: key === 'history' ? [key] : [key, pid] });
      onClose();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      width={960}
      title={t('replace.title')}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('common.cancel')}
        </Button>,
        <Button key="preview" onClick={() => run(true)} loading={busy && !preview} disabled={!matcher}>
          {t('replace.preview')}
        </Button>,
        <Button key="apply" type="primary" danger onClick={() => run(false)} loading={busy && !!preview} disabled={!preview?.affected}>
          {t('replace.apply', { count: preview?.affected ?? 0 })}
        </Button>,
      ]}
    >
      <Form layout="vertical">
        <Space.Compact block>
          <Form.Item label={t('replace.find')} htmlFor="replace-find" style={{ flex: 1, marginRight: 12 }} validateStatus={find && !matcher ? 'error' : undefined} help={find && !matcher ? t('error.REPLACE_INVALID_PATTERN') : undefined}>
            <Input id="replace-find" value={find} onChange={(e) => reset(setFind)(e.target.value)} placeholder="\n<Lucy>" autoFocus />
          </Form.Item>
          <Form.Item label={t('replace.with')} htmlFor="replace-with" style={{ flex: 1 }}>
            <Input id="replace-with" value={replace} onChange={(e) => reset(setReplace)(e.target.value)} placeholder="\n<露西>" />
          </Form.Item>
        </Space.Compact>
        <Space wrap size={16}>
          <Checkbox checked={caseSensitive} onChange={(e) => reset(setCaseSensitive)(e.target.checked)}>
            {t('replace.caseSensitive')}
          </Checkbox>
          <Checkbox checked={regex} onChange={(e) => reset(setRegex)(e.target.checked)}>
            {t('replace.regex')}
          </Checkbox>
          <Radio.Group value={scope} onChange={(e) => reset(setScope)(e.target.value)}>
            <Radio value="filter">{t('replace.scope.filter')}</Radio>
            <Radio value="project">{t('replace.scope.project')}</Radio>
          </Radio.Group>
        </Space>
        <Typography.Paragraph type="secondary" className="small" style={{ marginTop: 8 }}>
          {t('replace.hint')}
        </Typography.Paragraph>
      </Form>
      {preview && matcher && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type={preview.affected ? 'info' : 'warning'}
            showIcon
            message={
              preview.affected
                ? t('replace.summary', { count: preview.affected, occurrences: preview.occurrences })
                : t('replace.noMatch')
            }
            description={preview.skipped ? t('replace.skipped', { count: preview.skipped }) : undefined}
          />
          {preview.items.length > 0 && (
            <Table<PreviewItem>
              rowKey="id"
              size="small"
              className="replace-preview"
              pagination={false}
              scroll={{ y: 360 }}
              dataSource={preview.items}
              columns={[
                {
                  title: t('replace.col.entry'),
                  width: 240,
                  render: (_, r) => (
                    <div>
                      <div className="file-path small">{r.file.path}</div>
                      <div className="muted small">{r.contextText}</div>
                      <StageTag stage={r.stage} />
                    </div>
                  ),
                },
                { title: t('replace.col.before'), render: (_, r) => <Segments parts={replaceWithSegments(r.before, matcher, opts).before} kind="del" /> },
                { title: t('replace.col.after'), render: (_, r) => <Segments parts={replaceWithSegments(r.before, matcher, opts).after} kind="ins" /> },
              ]}
            />
          )}
          {preview.items.length < preview.affected && (
            <Typography.Text type="secondary" className="small">
              {t('replace.truncated', { shown: preview.items.length, total: preview.affected })}
            </Typography.Text>
          )}
        </Space>
      )}
    </Modal>
  );
}
