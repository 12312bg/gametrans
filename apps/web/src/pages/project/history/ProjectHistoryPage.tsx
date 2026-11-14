import { ArrowRightOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Card, Empty, Pagination, Segmented, Select, Skeleton, Space, Tag, Tooltip, Typography } from 'antd';
import { HISTORY_TYPES, HistoryType, TermSnapshot } from '@gametrans/shared';
import { Fragment, ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../../api/client';
import { useProject } from '../../../api/project';
import type { EntryHistoryRecord, Member, Paged, ProjectHistoryRecord, TermHistoryRecord } from '../../../api/types';
import { StageTag, UserAvatar } from '../../../components/Tags';
import { TFn, useT } from '../../../i18n';
import { historyNote } from '../../../i18n/format';
import { formatTime, fromNow } from '../../../utils';
import { DiffText } from './DiffText';

const PAGE_SIZE = 20;

/** 把翻译文本中的 {name} 占位替换成 React 节点 */
function rich(t: TFn, key: string, nodes: Record<string, ReactNode>, params: Record<string, unknown> = {}): ReactNode {
  const marks = Object.fromEntries(Object.keys(nodes).map((k) => [k, `\u0000${k}\u0000`]));
  const text = t(key, { ...params, ...marks });
  return text.split('\u0000').map((part, i) => <Fragment key={i}>{i % 2 ? nodes[part] : part}</Fragment>);
}

function EntryRecord({ r, pid }: { r: EntryHistoryRecord; pid: string }) {
  const t = useT();
  const link = (
    <Link to={`/projects/${pid}/editor?entry=${r.entry.id}`} className="history-entry-link">
      <span className="muted">{r.entry.path} |</span> {r.entry.key}
    </Link>
  );
  const prev = r.prevTranslation ?? '';
  const textChanged = r.action !== 'SOURCE_CHANGED' && prev !== r.translation;
  const stageChanged = !!r.prevStage && r.prevStage !== r.stage;
  const from = r.prevStage ? <StageTag stage={r.prevStage} /> : null;
  const to = <StageTag stage={r.stage} />;

  let head: ReactNode;
  if (r.action === 'SOURCE_CHANGED') head = rich(t, 'history.sentence.source', { entry: link });
  else if (!textChanged) head = rich(t, from ? 'history.sentence.stage' : 'history.sentence.stageTo', { entry: link, from, to });
  else {
    const key =
      r.action === 'TRANSLATE'
        ? prev
          ? 'history.sentence.edit'
          : 'history.sentence.translate'
        : `history.sentence.${r.action}`;
    head = rich(t, key, { entry: link }, { note: historyNote(r.action, r.note, t), time: r.action === 'ROLLBACK' && r.note ? formatTime(r.note) : '' });
  }

  return (
    <>
      <RecordHead r={r}>
        {head}
        {r.action === 'BATCH' && r.note && <Tag bordered={false}>{historyNote('BATCH', r.note, t)}</Tag>}
        {textChanged && stageChanged && (
          <span className="history-stage-change">
            {from} <ArrowRightOutlined className="muted" /> {to}
          </span>
        )}
      </RecordHead>
      <div className="history-body">
        {r.action === 'SOURCE_CHANGED' ? (
          <>
            <div className="history-label muted small">{t('history.label.source')}</div>
            <DiffText before={r.oldOriginal ?? ''} after={r.newOriginal ?? ''} />
            {stageChanged && (
              <div className="history-stage-row">
                {from} <ArrowRightOutlined className="muted" /> {to}
              </div>
            )}
          </>
        ) : textChanged ? (
          r.translation === '' ? (
            <div className="diff-text pre-wrap">
              <del>{prev}</del>
            </div>
          ) : (
            <DiffText before={prev} after={r.translation} />
          )
        ) : (
          <div className="history-stage-split">
            <div>{from ?? <span className="muted">-</span>}</div>
            <div>{to}</div>
          </div>
        )}
      </div>
    </>
  );
}

const TERM_FIELDS: (keyof TermSnapshot)[] = ['term', 'translation', 'note'];

function TermRecord({ r, pid }: { r: TermHistoryRecord; pid: string }) {
  const t = useT();
  const name = r.action === 'DELETE' ? <b>{r.term}</b> : <Link to={`/projects/${pid}/terms`}>{r.term}</Link>;
  const key = r.action === 'IMPORT' && r.before ? 'history.sentence.term.IMPORT_UPDATE' : `history.sentence.term.${r.action}`;
  const b = r.before;
  const a = r.after;
  return (
    <>
      <RecordHead r={r}>{rich(t, key, { term: name })}</RecordHead>
      <div className="history-body history-term">
        {TERM_FIELDS.map((f) => {
          const before = String(b?.[f] ?? '');
          const after = String(a?.[f] ?? '');
          if (!before && !after) return null;
          return (
            <div key={f} className="history-term-row">
              <span className="history-label muted small">{t(`history.field.${f}`)}</span>
              {a && b ? (
                before === after ? (
                  <div className="diff-text pre-wrap">{after}</div>
                ) : (
                  <DiffText before={before} after={after} />
                )
              ) : (
                <div className="diff-text pre-wrap">{a ? <ins>{after}</ins> : <del>{before}</del>}</div>
              )}
            </div>
          );
        })}
        {a && b && a.caseSensitive !== b.caseSensitive && (
          <div className="history-term-row">
            <span className="history-label muted small">{t('history.field.caseSensitive')}</span>
            <span>{t(a.caseSensitive ? 'history.yes' : 'history.no')}</span>
          </div>
        )}
      </div>
    </>
  );
}

function RecordHead({ r, children }: { r: ProjectHistoryRecord; children: ReactNode }) {
  const t = useT();
  return (
    <div className="history-head">
      <div className="history-head-main">
        <UserAvatar user={r.user} />
        <span>
          <b>{r.user?.displayName ?? t('common.system')}</b> {children}
        </span>
      </div>
      <Tooltip title={formatTime(r.createdAt)}>
        <span className="muted small history-time">{fromNow(r.createdAt)}</span>
      </Tooltip>
    </div>
  );
}

export default function ProjectHistoryPage() {
  const t = useT();
  const { project } = useProject();
  const pid = project.id;
  const [params, setParams] = useSearchParams();
  const type = (HISTORY_TYPES as readonly string[]).includes(params.get('type') ?? '') ? (params.get('type') as HistoryType) : undefined;
  const userId = params.get('user') ?? undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const set = (patch: Record<string, string | undefined>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  const q = useQuery({
    queryKey: ['project-history', pid, type, userId, page],
    queryFn: () => api<Paged<ProjectHistoryRecord>>(`/projects/${pid}/history${qs({ type, userId, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });
  const members = useQuery({ queryKey: ['members', pid], queryFn: () => api<Member[]>(`/projects/${pid}/members`) });

  return (
    <Card
      variant="borderless"
      title={t('history.title')}
      extra={
        <Space wrap>
          <Segmented
            value={type ?? 'all'}
            onChange={(v) => set({ type: v === 'all' ? undefined : String(v) })}
            options={[{ value: 'all', label: t('history.type.all') }, ...HISTORY_TYPES.map((v) => ({ value: v, label: t(`history.type.${v}`) }))]}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 180 }}
            placeholder={t('history.allUsers')}
            value={userId}
            onChange={(v) => set({ user: v })}
            options={(members.data ?? []).map((m) => ({ value: m.userId, label: m.user.displayName }))}
          />
        </Space>
      }
    >
      {q.isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !q.data?.items.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('history.empty')} />
      ) : (
        <div className={`history-feed${q.isPlaceholderData ? ' loading' : ''}`}>
          {q.data.items.map((r) => (
            <div key={r.id} className="history-record">
              {r.kind === 'entry' ? <EntryRecord r={r} pid={pid} /> : <TermRecord r={r} pid={pid} />}
            </div>
          ))}
          <div className="history-pager">
            <Typography.Text type="secondary" className="small">
              {t('history.total', { count: q.data.total.toLocaleString() })}
            </Typography.Text>
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={q.data.total}
              showSizeChanger={false}
              showQuickJumper
              onChange={(pg) => set({ page: pg > 1 ? String(pg) : undefined })}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
