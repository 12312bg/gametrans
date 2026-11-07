import { Checkbox, Empty, Pagination, Spin } from 'antd';
import { useEffect, useRef } from 'react';
import type { Entry } from '../../../api/types';
import { StageDot } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { CodesOnly } from './highlight';

interface Props {
  items: Entry[];
  total: number | undefined;
  loading: boolean;
  fetching: boolean;
  emptyText: string;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  drafts: Record<string, string>;
  batchMode: boolean;
  checked: Set<string>;
  onChecked: (s: Set<string>) => void;
}

export function EntryList(p: Props) {
  const t = useT();
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (p.selectedId) itemRefs.current.get(p.selectedId)?.scrollIntoView({ block: 'nearest' });
  }, [p.selectedId]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(p.checked);
    if (on) next.add(id);
    else next.delete(id);
    p.onChecked(next);
  };

  return (
    <div className="editor-list">
      <div className="list-head">
        <span>{t('editor.total', { count: p.total?.toLocaleString() ?? '-' })}</span>
        {p.fetching && <Spin size="small" />}
      </div>
      <div className="list-scroll">
        {p.loading ? (
          <div className="center-spin">
            <Spin />
          </div>
        ) : !p.items.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 60 }} description={p.emptyText} />
        ) : (
          p.items.map((e, idx) => {
            const dirty = p.drafts[e.id] !== undefined && p.drafts[e.id] !== e.translation;
            return (
              <div
                key={e.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(e.id, el);
                  else itemRefs.current.delete(e.id);
                }}
                className={`entry-item${e.id === p.selectedId ? ' active' : ''}`}
                onClick={() => p.onSelect(e.id)}
              >
                {p.batchMode && <Checkbox checked={p.checked.has(e.id)} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => toggle(e.id, ev.target.checked)} />}
                <div className="entry-item-main">
                  <div className="entry-item-top">
                    <StageDot stage={e.stage} />
                    <span className="entry-index">#{(p.page - 1) * p.pageSize + idx + 1}</span>
                    <span className="entry-cat">{t(`category.${e.category}`)}</span>
                    {dirty && <span className="dirty-dot" title={t('editor.unsaved')} />}
                  </div>
                  <div className="entry-item-src">
                    <CodesOnly text={e.original} />
                  </div>
                  <div className={`entry-item-dst${e.translation ? '' : ' empty'}`}>{dirty ? p.drafts[e.id] : e.translation || t('editor.untranslated')}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="list-foot">
        <Pagination size="small" simple current={p.page} pageSize={p.pageSize} total={p.total ?? 0} onChange={p.onPage} />
      </div>
    </div>
  );
}
