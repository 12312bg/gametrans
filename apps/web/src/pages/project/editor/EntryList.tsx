import { Avatar, Checkbox, Empty, Pagination, Spin } from 'antd';
import { useEffect, useRef } from 'react';
import { Trans } from 'react-i18next';
import type { RtUser } from '@gametrans/shared';
import type { RemoteChange } from '../../../api/realtime';
import type { Entry } from '../../../api/types';
import { StageDot, UserAvatar } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { CodesOnly } from './highlight';

export const PAGE_SIZES = [20, 50, 100, 200];

interface Props {
  items: Entry[];
  total: number | undefined;
  loading: boolean;
  fetching: boolean;
  emptyText: string;
  page: number;
  pageSize: number;
  onPage: (page: number, pageSize: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  drafts: Record<string, string>;
  /** 其他成员正在编辑的词条 */
  editors: Map<string, RtUser[]>;
  /** 其他成员刚修改过的词条 */
  remote: Record<string, RemoteChange>;
  batchMode: boolean;
  checked: Set<string>;
  onChecked: (s: Set<string>) => void;
}

export function EntryList(p: Props) {
  const t = useT();
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  // 选中项变化后滚动到它；跳转到其他页时等新一页渲染出来再滚动（只滚动一次，实时更新不会把列表拉回）
  const pendingScroll = useRef<string | null>(null);
  useEffect(() => {
    pendingScroll.current = p.selectedId;
  }, [p.selectedId]);
  useEffect(() => {
    const id = pendingScroll.current;
    const el = id ? itemRefs.current.get(id) : undefined;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    pendingScroll.current = null;
  }, [p.selectedId, p.items]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(p.checked);
    if (on) next.add(id);
    else next.delete(id);
    p.onChecked(next);
  };

  return (
    <div className="editor-list">
      <div className="list-head">
        <span>
          <Trans i18nKey="editor.total" values={{ count: p.total?.toLocaleString() ?? '-' }} components={{ b: <b /> }} />
        </span>
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
            const others = p.editors.get(e.id);
            const changed = p.remote[e.id];
            const flash = changed && changed.version === e.version && Date.now() - changed.at < 5000;
            return (
              <div
                key={e.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(e.id, el);
                  else itemRefs.current.delete(e.id);
                }}
                className={`entry-item${e.id === p.selectedId ? ' active' : ''}${flash ? ' remote-flash' : ''}`}
                onClick={() => p.onSelect(e.id)}
              >
                {p.batchMode && <Checkbox checked={p.checked.has(e.id)} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => toggle(e.id, ev.target.checked)} />}
                <div className="entry-item-main">
                  <div className="entry-item-top">
                    <StageDot stage={e.stage} />
                    <span className="entry-index">#{(p.page - 1) * p.pageSize + idx + 1}</span>
                    <span className="entry-cat">{t(`category.${e.category}`)}</span>
                    {dirty && <span className="dirty-dot" title={t('editor.unsaved')} />}
                    {others && (
                      <span className="entry-editors" title={t('realtime.editingBy', { names: others.map((u) => u.displayName).join(', ') })}>
                        <Avatar.Group size={16} max={{ count: 2 }}>
                          {others.map((u) => (
                            <UserAvatar key={u.id} user={u} size={16} />
                          ))}
                        </Avatar.Group>
                      </span>
                    )}
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
        <Pagination
          size="small"
          simple
          current={p.page}
          pageSize={p.pageSize}
          total={p.total ?? 0}
          showSizeChanger
          pageSizeOptions={PAGE_SIZES}
          onChange={p.onPage}
        />
      </div>
    </div>
  );
}
