import { RollbackOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Empty, List, Popconfirm, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { HISTORY_ACTION_LABELS, HistoryAction } from '@gametrans/shared';
import { api } from '../api/client';
import type { Entry, HistoryItem, Neighbor, Suggestion, Term } from '../api/types';
import { StageDot, StageTag, UserAvatar } from '../components/Tags';
import { formatTime, fromNow } from '../utils';
import { CodesOnly } from './highlight';

export function TermsTab({ matched, onInsert, canEdit }: { matched: Term[]; onInsert: (t: string) => void; canEdit: boolean }) {
  if (!matched.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="原文中没有命中术语" />;
  return (
    <List
      size="small"
      dataSource={matched}
      renderItem={(t) => (
        <List.Item
          actions={
            canEdit
              ? [
                  <Button key="ins" size="small" type="link" onClick={() => onInsert(t.translation)}>
                    插入
                  </Button>,
                ]
              : undefined
          }
        >
          <div className="term-row">
            <span className="term-src">{t.term}</span>
            <span className="term-arrow">→</span>
            <b>{t.translation}</b>
            {t.note && <div className="muted small">{t.note}</div>}
          </div>
        </List.Item>
      )}
    />
  );
}

export function TMTab({ pid, entry, onUse, canEdit }: { pid: string; entry: Entry; onUse: (t: string) => void; canEdit: boolean }) {
  const q = useQuery({
    queryKey: ['suggestions', entry.id, entry.original],
    queryFn: () => api<Suggestion[]>(`/projects/${pid}/entries/${entry.id}/suggestions`),
    staleTime: 60_000,
  });
  if (q.isLoading) return <div className="center-spin small"><Spin size="small" /></div>;
  if (!q.data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有相似的已有译文" />;
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
                        使用
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
  const q = useQuery({
    queryKey: ['neighbors', entry.id],
    queryFn: () => api<{ before: Neighbor[]; after: Neighbor[] }>(`/projects/${pid}/entries/${entry.id}/neighbors`),
    staleTime: 30_000,
  });
  if (q.isLoading) return <div className="center-spin small"><Spin size="small" /></div>;
  const row = (n: Neighbor, current = false) => (
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
      {row({ id: entry.id, original: entry.original, translation: entry.translation, stage: entry.stage, category: entry.category, sortOrder: entry.sortOrder }, true)}
      {q.data?.after.map((n) => row(n))}
      <Typography.Paragraph type="secondary" className="small" style={{ marginTop: 8 }}>
        同一文件中前后相邻的词条，点击可跳转（筛选条件内不可见的词条会临时显示）。
      </Typography.Paragraph>
    </div>
  );
}

export function HistoryTab({
  pid,
  entry,
  canEdit,
  onRollback,
}: {
  pid: string;
  entry: Entry;
  canEdit: boolean;
  onRollback: (h: HistoryItem) => void;
}) {
  const q = useQuery({
    queryKey: ['history', entry.id, entry.version],
    queryFn: () => api<HistoryItem[]>(`/projects/${pid}/entries/${entry.id}/history`),
  });
  if (q.isLoading) return <div className="center-spin small"><Spin size="small" /></div>;
  if (!q.data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无修改记录" />;
  return (
    <List
      size="small"
      dataSource={q.data}
      renderItem={(h, i) => (
        <List.Item
          actions={
            canEdit && i > 0 && h.action !== 'SOURCE_CHANGED' && h.translation !== entry.translation
              ? [
                  <Popconfirm key="rb" title="回滚到这个版本的译文？" onConfirm={() => onRollback(h)} okText="回滚">
                    <Button size="small" type="link" icon={<RollbackOutlined />}>
                      回滚
                    </Button>
                  </Popconfirm>,
                ]
              : undefined
          }
        >
          <div className="history-row">
            <Space size={6} wrap>
              <UserAvatar user={h.user} />
              <b>{h.user?.displayName ?? '系统'}</b>
              <Tag bordered={false}>{HISTORY_ACTION_LABELS[h.action as HistoryAction] ?? h.action}</Tag>
              <StageTag stage={h.stage} />
              <Tooltip title={formatTime(h.createdAt)}>
                <span className="muted small">{fromNow(h.createdAt)}</span>
              </Tooltip>
            </Space>
            {h.action === 'SOURCE_CHANGED' ? (
              <div className="history-text muted pre-wrap">旧原文：{h.note}</div>
            ) : (
              <div className="history-text pre-wrap">{h.translation || <span className="muted">（空）</span>}</div>
            )}
          </div>
        </List.Item>
      )}
    />
  );
}
