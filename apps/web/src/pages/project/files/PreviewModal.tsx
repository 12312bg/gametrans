import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, List, Modal, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { api } from '../../../api/client';
import type { FilePreview, Job, ParseResultData } from '../../../api/types';
import { StageTag } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { issueText, jobErrorText } from '../../../i18n/format';
import { errorMessage } from '../../../utils';

const STATUS_COLOR = { created: 'blue', updated: 'orange', unchanged: 'default' } as const;

function Truncated({ shown, total }: { shown: number; total: number }) {
  const t = useT();
  return shown < total ? <Typography.Text type="secondary">{t('preview.truncated', { shown, total })}</Typography.Text> : null;
}

/** 单个文件的变更明细 */
function FileDetails({ f }: { f: FilePreview }) {
  const t = useT();
  const { changed, removed, added } = f.details;
  const tabs = [
    f.changed > 0 && {
      key: 'changed',
      label: t('preview.tab.changed', { count: f.changed }),
      children: (
        <>
          <List
            size="small"
            dataSource={changed}
            renderItem={(c) => (
              <List.Item>
                <div className="preview-item">
                  <div className="muted small">{t('preview.before')}</div>
                  <div className="pre-wrap preview-before">{c.before}</div>
                  <div className="muted small">{t('preview.after')}</div>
                  <div className="pre-wrap">{c.after}</div>
                  {c.translation && (
                    <>
                      <div className="muted small">{t('preview.translation')}</div>
                      <div className="pre-wrap">{c.translation}</div>
                    </>
                  )}
                </div>
              </List.Item>
            )}
          />
          <Truncated shown={changed.length} total={f.changed} />
        </>
      ),
    },
    f.removed > 0 && {
      key: 'removed',
      label: t('preview.tab.removed', { count: f.removed }),
      children: (
        <>
          <List
            size="small"
            dataSource={removed}
            renderItem={(r) => (
              <List.Item>
                <div className="preview-item">
                  <div className="pre-wrap">{r.original}</div>
                  {r.translation && (
                    <Space align="start" className="preview-lost">
                      <StageTag stage={r.stage} />
                      <span className="pre-wrap">{r.translation}</span>
                    </Space>
                  )}
                </div>
              </List.Item>
            )}
          />
          <Truncated shown={removed.length} total={f.removed} />
        </>
      ),
    },
    f.added > 0 && {
      key: 'added',
      label: t('preview.tab.added', { count: f.added }),
      children: (
        <>
          <List size="small" dataSource={added} renderItem={(a) => <List.Item className="pre-wrap">{a.original}</List.Item>} />
          <Truncated shown={added.length} total={f.added} />
        </>
      ),
    },
  ].filter((x): x is Exclude<typeof x, false> => !!x);
  return <Tabs size="small" items={tabs} />;
}

/** 上传新版本前的变更预览：确认后导入，取消则丢弃本次上传 */
export function PreviewModal({ pid, jobId, onClose }: { pid: string; jobId: string; onClose: (applied: boolean) => void }) {
  const t = useT();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const job = useQuery({
    queryKey: ['job', pid, jobId],
    queryFn: () => api<Job<ParseResultData>>(`/projects/${pid}/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data?.status === 'SUCCEEDED' || q.state.data?.status === 'FAILED' ? false : 1000),
  });
  const data = job.data;
  const result = data?.status === 'SUCCEEDED' ? data.result : null;
  const files = (result?.files ?? []) as FilePreview[];
  const sum = (k: 'added' | 'changed' | 'removed' | 'removedTranslated') => files.reduce((n, f) => n + (f[k] ?? 0), 0);
  const count = (s: FilePreview['status']) => files.filter((f) => f.status === s).length;
  const lost = sum('removedTranslated');
  const hasChanges = files.some((f) => f.status !== 'unchanged');

  const run = async (apply: boolean) => {
    setBusy(true);
    try {
      await api(`/projects/${pid}/jobs/${jobId}${apply ? '/apply' : ''}`, { method: apply ? 'POST' : 'DELETE' });
      message.success(t(apply ? 'preview.confirmed' : 'preview.cancelled'));
      onClose(apply);
    } catch (e) {
      message.error(errorMessage(e));
      if (!apply) onClose(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      width={880}
      title={t('preview.title')}
      maskClosable={false}
      onCancel={() => run(false)}
      footer={[
        <Button key="cancel" onClick={() => run(false)} disabled={busy}>
          {t('common.cancel')}
        </Button>,
        <Button key="ok" type="primary" danger={lost > 0} loading={busy} disabled={!result || !hasChanges} onClick={() => run(true)}>
          {t('preview.confirm')}
        </Button>,
      ]}
    >
      {data?.status === 'FAILED' ? (
        <Alert type="error" showIcon message={t('preview.failed')} description={jobErrorText(data.error, t)} />
      ) : !result ? (
        <div className="center-spin">
          <Spin tip={t('preview.analyzing')}>
            <div style={{ height: 80 }} />
          </Spin>
        </div>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }} className="preview-body">
          <Alert
            type={lost ? 'warning' : 'info'}
            showIcon
            message={
              hasChanges
                ? t('preview.summary', { updated: count('updated'), created: count('created'), added: sum('added'), changed: sum('changed'), removed: sum('removed') })
                : t('preview.noChange')
            }
            description={lost ? t('preview.lossWarning', { count: lost }) : undefined}
          />
          <Table<FilePreview>
            rowKey="path"
            size="small"
            pagination={false}
            dataSource={files}
            scroll={{ y: 420 }}
            expandable={{ expandedRowRender: (f) => <FileDetails f={f} />, rowExpandable: (f) => f.status === 'updated' }}
            columns={[
              { title: t('preview.col.file'), dataIndex: 'path', render: (p: string) => <span className="file-path">{p}</span> },
              {
                title: t('preview.col.status'),
                width: 90,
                render: (_, f) => (
                  <Tag bordered={false} color={STATUS_COLOR[f.status]}>
                    {t(`preview.status.${f.status}`)}
                  </Tag>
                ),
              },
              { title: t('preview.col.added'), width: 80, dataIndex: 'added' },
              { title: t('preview.col.changed'), width: 90, dataIndex: 'changed' },
              {
                title: t('preview.col.removed'),
                width: 150,
                render: (_, f) => (
                  <span>
                    {f.removed}
                    {f.removedTranslated > 0 && <Typography.Text type="danger">{t('preview.withTranslation', { count: f.removedTranslated })}</Typography.Text>}
                  </span>
                ),
              },
            ]}
          />
          {(result.skipped.length > 0 || result.errors.length > 0) && (
            <Alert
              type="warning"
              message={t('preview.issues', { skipped: result.skipped.length, failed: result.errors.length })}
              description={[...result.errors, ...result.skipped].map((x) => `${x.name}: ${issueText(x, t)}`).join('\n')}
              className="pre-wrap"
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
