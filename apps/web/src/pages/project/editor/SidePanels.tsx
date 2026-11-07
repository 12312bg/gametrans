import { RollbackOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Empty, List, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { hasMessage } from '@gametrans/shared';
import { api } from '../../../api/client';
import type { Entry, HistoryItem, Neighbor, Suggestion, Term } from '../../../api/types';
import { StageDot, StageTag, UserAvatar } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { historyNote } from '../../../i18n/format';
import { formatTime, fromNow } from '../../../utils';
import { CodesOnly } from './highlight';

const Loading = () => (
  <div className="center-spin small">
    <Spin size="small" />
  </div>
);
const Nothing = ({ text }: { text: string }) => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;

export function TermsTab({ matched, onInsert, canEdit }: { matched: Term[]; onInsert: (t: string) => void; canEdit: boolean }) {
  const t = useT();
  if (!matched.length) return <Nothing text={t('side.noTerms')} />;
  return (
    <List
      size="small"
      dataSource={matched}
      renderItem={(term) => (
        <List.Item
          actions={
            canEdit
              ? [
                  <Button key="ins" size="small" type="link" onClick={() => onInsert(term.translation)}>
                    {t('side.insert')}
                  </Button>,
                ]
              : undefined
          }
        >
          <div className="term-row">
            <span className="term-src">{term.term}</span>
            <span className="term-arrow">→</span>
            <b>{term.translation}</b>
            {term.note && <div className="muted small">{term.note}</div>}
          </div>
        </List.Item>
      )}
    />
  );
}

export function TMTab({ pid, entry, onUse, canEdit }: { pid: string; entry: Entry; onUse: (t: string) => void; canEdit: boolean }) {
  const t = useT();
  const q = useQuery({
    queryKey: ['suggestions', entry.id, entry.original],
    queryFn: () => api<Suggestion[]>(`/projects/${pid}/entries/${entry.id}/suggestions`),
    staleTime: 60_000,
  });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Nothing text={t('side.noTm')} />;
  return (
    <List
      size="small"
      dataSource={q.data}
      renderItem={(s, i) => {
        const pct = Math.round(s.score * 100);
        return (
          <List.Item
            actions={
              canEdit
                ? [
                    <Tooltip key="use" title={i < 5 ? `Alt+${i + 1}` : undefined}>
                      <Button size="small" type="link" onClick={() => onUse(s.translation)}>
                        {t('side.use')}
                      </Button>
                    </Tooltip>,
                  ]
                : undefined
            }
          >
            <div className="tm-row">
              <Space size={6}>
                <Tag color={pct >= 100 ? 'green' : pct >= 70 ? 'blue' : 'default'} bordered={false}>
                  {pct}%
                </Tag>
                <StageDot stage={s.stage} />
                <span className="muted small">{s.path}</span>
              </Space>
              <div className="tm-src pre-wrap">
                <CodesOnly text={s.original} />
              </div>
              <div className="tm-dst pre-wrap">
                <CodesOnly text={s.translation} />
              </div>
            </div>
          </List.Item>
        );
      }}
    />
  );
}

export function ContextTab({ pid, entry, onJump }: { pid: string; entry: Entry; onJump: (id: string) => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ['neighbors', entry.id],
    queryFn: () => api<{ before: Neighbor[]; after: Neighbor[] }>(`/projects/${pid}/entries/${entry.id}/neighbors`),
    staleTime: 30_000,
  });
  if (q.isLoading) return <Loading />;
  const row = (n: Pick<Neighbor, 'id' | 'original' | 'translation' | 'stage'>, current = false) => (
    <div key={n.id} className={`ctx-row${current ? ' current' : ''}`} onClick={() => !current && onJump(n.id)}>
      <StageDot stage={n.stage} />
      <div className="ctx-text">
        <div className="pre-wrap">
          <CodesOnly text={n.original} />
        </div>
        {n.translation && (
          <div className="pre-wrap muted">
            <CodesOnly text={n.translation} />
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="ctx-list">
      {q.data?.before.map((n) => row(n))}
      {row(entry, true)}
      {q.data?.after.map((n) => row(n))}
      <Typography.Paragraph type="secondary" className="small" style={{ marginTop: 8 }}>
        {t('side.contextHint')}
      </Typography.Paragraph>
    </div>
  );
}

export function HistoryTab({ pid, entry, canEdit, onRollback }: { pid: string; entry: Entry; canEdit: boolean; onRollback: (h: HistoryItem) => void }) {
  const t = useT();
  const q = useQuery({
    queryKey: ['history', entry.id, entry.version],
    queryFn: () => api<HistoryItem[]>(`/projects/${pid}/entries/${entry.id}/history`),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <Nothing text={t('side.noHistory')} />;
  return (
    <List
      size="small"
      dataSource={q.data}
      renderItem={(h, i) => (
        <List.Item
          actions={
            canEdit && i > 0 && h.action !== 'SOURCE_CHANGED' && h.translation !== entry.translation
              ? [
                  <Popconfirm key="rb" title={t('side.rollbackConfirm')} onConfirm={() => onRollback(h)} okText={t('side.rollback')}>
                    <Button size="small" type="link" icon={<RollbackOutlined />}>
                      {t('side.rollback')}
                    </Button>
                  </Popconfirm>,
                ]
              : undefined
          }
        >
          <div className="history-row">
            <Space size={6} wrap>
              <UserAvatar user={h.user} />
              <b>{h.user?.displayName ?? t('common.system')}</b>
              <Tag bordered={false}>{hasMessage(`history.${h.action}`) ? t(`history.${h.action}`) : h.action}</Tag>
              {h.action === 'BATCH' && h.note && <span className="muted small">{historyNote(h.action, h.note, t)}</span>}
              <StageTag stage={h.stage} />
              <Tooltip title={formatTime(h.createdAt)}>
                <span className="muted small">{fromNow(h.createdAt)}</span>
              </Tooltip>
            </Space>
            {h.action === 'SOURCE_CHANGED' ? (
              <div className="history-text muted pre-wrap">{t('side.oldSource', { text: h.note })}</div>
            ) : (
              <div className="history-text pre-wrap">{h.translation || <span className="muted">{t('common.empty')}</span>}</div>
            )}
          </div>
        </List.Item>
      )}
    />
  );
}
