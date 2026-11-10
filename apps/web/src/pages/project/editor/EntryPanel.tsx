import {
  CheckOutlined,
  CopyOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  MoreOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  UnlockOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Dropdown, Input, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { Engine, PERMISSIONS, Permission, Stage, missingControlCodes, missingTags } from '@gametrans/shared';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { Entry, HistoryItem, Term } from '../../../api/types';
import { StageTag, UserAvatar } from '../../../components/Tags';
import { TFn, useT } from '../../../i18n';
import { contextText } from '../../../i18n/format';
import { errorMessage, fromNow } from '../../../utils';
import { Highlighted, findTerms } from './highlight';
import { ContextTab, HistoryTab, LinkedTab, TMTab, TermsTab, useLinked } from './SidePanels';

export interface EntryPanelHandle {
  focus(): void;
}

interface Props {
  pid: string;
  engine: Engine;
  entry: Entry;
  draft: string;
  onDraft: (v: string) => void;
  terms: Term[];
  has: (p: Permission) => boolean;
  canEdit: boolean;
  saving: boolean;
  onSave: (opts?: { stage?: Stage; next?: boolean }) => void;
  onRollback: (h: HistoryItem) => void;
  onJump: (id: string) => void;
  /** 点击文件名：只看该文件的词条 */
  onFile: () => void;
  sideTab: string;
  onSideTab: (k: string) => void;
}

const lineCount = (s: string) => (s === '' ? 0 : s.split('\n').length);
const DANGER_HINT: Record<string, string> = {
  script: 'entry.warnScript',
  plugin: 'entry.warnPlugin',
  variable: 'entry.warnVariable',
  comment: 'entry.warnComment',
  eventName: 'entry.warnEventName',
  mapName: 'entry.warnMapName',
};
/** 这些分类的文本里有插件读取的 <标签> */
const TAGGED = new Set(['comment', 'note']);

interface QaItem {
  type: 'warning' | 'info';
  text: string;
}

/** 译文质量检查：控制符、行数、首尾空白、术语 */
function qaCheck(entry: Entry, draft: string, engine: Engine, matched: Term[], t: TFn): QaItem[] {
  const out: QaItem[] = [];
  if (!draft) return out;
  const missing = missingControlCodes(entry.original, draft);
  if (missing.length) out.push({ type: 'warning', text: t('entry.qa.missingCodes', { codes: [...new Set(missing)].join(' ') }) });
  const tags = TAGGED.has(entry.category) ? missingTags(entry.original, draft) : [];
  if (tags.length) out.push({ type: 'warning', text: t('entry.qa.missingTags', { tags: [...new Set(tags)].join(' ') }) });
  const lo = lineCount(entry.original);
  const lt = lineCount(draft);
  if (entry.category === 'dialogue') {
    if (engine === 'RMXP' && lt > 4) out.push({ type: 'warning', text: t('entry.qa.xpLines', { lines: lt }) });
    else if (lt > lo) out.push({ type: 'info', text: t('entry.qa.moreLines', { lines: lt, original: lo }) });
  }
  const lead = (s: string) => /^\s/.test(s);
  const trail = (s: string) => /\s$/.test(s);
  if (lead(entry.original) !== lead(draft) || trail(entry.original) !== trail(draft)) out.push({ type: 'info', text: t('entry.qa.whitespace') });
  for (const term of matched) {
    const hay = term.caseSensitive ? draft : draft.toLowerCase();
    const needle = term.caseSensitive ? term.translation : term.translation.toLowerCase();
    if (!hay.includes(needle)) out.push({ type: 'info', text: t('entry.qa.term', { term: term.term, translation: term.translation }) });
  }
  return out;
}

/** 原文相同的脚本 / 插件字符串：提示译文不一致并可一键同步 */
function LinkedNotice({ pid, entry, others, canEdit, dirty }: { pid: string; entry: Entry; others: Entry[]; canEdit: boolean; dirty: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const differ = others.filter((e) => e.translation !== entry.translation || e.stage !== entry.stage).length;
  const sync = async () => {
    setBusy(true);
    try {
      const r = await api<{ affected: number; skipped: number }>(`/projects/${pid}/entries/${entry.id}/sync`, { method: 'POST' });
      message.success(r.skipped ? t('linked.syncedSkipped', { count: r.affected, skipped: r.skipped }) : t('linked.synced', { count: r.affected }));
      for (const key of ['linked', 'entries', 'entry', 'project', 'files']) qc.invalidateQueries({ queryKey: key === 'linked' ? [key] : [key, pid] });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Alert
      className="entry-alert linked-notice"
      type={differ ? 'warning' : 'info'}
      showIcon
      message={
        <span>
          {t('linked.notice', { count: others.length })}
          {differ > 0 && ` ${t('linked.differ', { count: differ })}`}
        </span>
      }
      action={
        canEdit && differ > 0 ? (
          <Tooltip title={dirty || !entry.translation ? t('linked.saveFirst') : undefined}>
            <Button size="small" loading={busy} disabled={dirty || !entry.translation} onClick={sync}>
              {t('linked.sync', { count: differ })}
            </Button>
          </Tooltip>
        ) : undefined
      }
    />
  );
}

export const EntryPanel = forwardRef<EntryPanelHandle, Props>(function EntryPanel(props, ref) {
  const { pid, engine, entry, draft, onDraft, terms, has, canEdit, saving, onSave } = props;
  const t = useT();
  const taRef = useRef<TextAreaRef>(null);
  const dirty = draft !== entry.translation;

  const insert = (text: string) => {
    const el = taRef.current?.resizableTextArea?.textArea;
    if (!el) return onDraft(draft + text);
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    onDraft(draft.slice(0, start) + text + draft.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus({ cursor: 'end' }) }));

  const { matched } = useMemo(() => findTerms(entry.original, terms), [entry.original, terms]);
  const linked = useLinked(pid, entry).data ?? [];
  const qa = useMemo(() => qaCheck(entry, draft, engine, matched, t), [entry, draft, engine, matched, t]);

  const stage = entry.stage;
  const hasText = draft.trim() !== '';
  const readOnlyReason = !has(PERMISSIONS.TRANSLATE)
    ? t('entry.readonly.noPermission')
    : stage === 'REVIEWED' || stage === 'LOCKED' || stage === 'HIDDEN'
      ? t(`entry.readonly.${stage}`)
      : '';

  const moreItems = has(PERMISSIONS.MANAGE_ENTRIES)
    ? [
        stage === 'LOCKED'
          ? { key: 'unlock', icon: <UnlockOutlined />, label: t('entry.unlock'), onClick: () => onSave({ stage: entry.translation || hasText ? 'REVIEWED' : 'UNTRANSLATED' }) }
          : { key: 'lock', icon: <LockOutlined />, label: t('entry.lock'), onClick: () => onSave({ stage: 'LOCKED' }) },
        stage === 'HIDDEN'
          ? { key: 'unhide', icon: <EyeOutlined />, label: t('entry.unhide'), onClick: () => onSave({ stage: hasText ? 'TRANSLATED' : 'UNTRANSLATED' }) }
          : { key: 'hide', icon: <EyeInvisibleOutlined />, label: t('entry.hide'), onClick: () => onSave({ stage: 'HIDDEN' }) },
      ]
    : [];
  const canReview = has(PERMISSIONS.REVIEW);

  return (
    <div className="entry-panel">
      <div className="entry-meta">
        <Space size={6} wrap>
          <StageTag stage={stage} />
          <Tag bordered={false}>{t(`category.${entry.category}`)}</Tag>
          <Tooltip title={t('entry.showFile')}>
            <Typography.Link className="small entry-file" onClick={props.onFile}>
              {entry.file.path}
            </Typography.Link>
          </Tooltip>
          <Typography.Text type="secondary" className="small" copyable={{ text: entry.key, tooltips: [t('entry.copyKey'), t('entry.copied')] }}>
            {entry.key}
          </Typography.Text>
        </Space>
        <div className="entry-context">{contextText(entry, t)}</div>
      </div>

      {entry.danger && (
        <Alert type="warning" showIcon icon={<WarningOutlined />} className="entry-alert" message={t(DANGER_HINT[entry.category] ?? 'entry.warnNote')} />
      )}

      {linked.length > 0 && <LinkedNotice pid={pid} entry={entry} others={linked} canEdit={canEdit} dirty={dirty} />}

      <div className="text-block">
        <div className="text-block-head">
          <span>{t('entry.original')}</span>
          <Space size={2}>
            <span className="muted small">{t('entry.chars', { count: entry.original.length })}</span>
            {canEdit && (
              <Tooltip title={t('entry.copySource')}>
                <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => onDraft(entry.original)} />
              </Tooltip>
            )}
          </Space>
        </div>
        <div className="original-text pre-wrap">
          <Highlighted text={entry.original} terms={terms} />
        </div>
      </div>

      <div className="text-block">
        <div className="text-block-head">
          <span>
            {t('entry.translation')}{' '}
            {dirty && (
              <Tag color="orange" bordered={false}>
                {t('entry.unsaved')}
              </Tag>
            )}
          </span>
          <span className="muted small">{t('entry.chars', { count: draft.length })}</span>
        </div>
        <Input.TextArea
          ref={taRef}
          className="translation-input"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          autoSize={{ minRows: 4, maxRows: 16 }}
          disabled={!canEdit}
          placeholder={canEdit ? t('entry.placeholder') : readOnlyReason}
          spellCheck={false}
        />
        {!canEdit && readOnlyReason && (
          <Typography.Text type="secondary" className="small">
            {readOnlyReason}
          </Typography.Text>
        )}
        {qa.length > 0 && (
          <div className="qa-list">
            {qa.map((w, i) => (
              <div key={i} className={`qa-item ${w.type}`}>
                <WarningOutlined /> {w.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="entry-actions">
        <Space wrap>
          {canEdit && (
            <>
              <Tooltip title="Ctrl+Enter">
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => onSave({ next: true })}>
                  {t('entry.saveNext')}
                </Button>
              </Tooltip>
              <Tooltip title="Ctrl+S">
                <Button loading={saving} disabled={!dirty} onClick={() => onSave()}>
                  {t('common.save')}
                </Button>
              </Tooltip>
            </>
          )}
          {canEdit && stage !== 'QUESTIONED' && stage !== 'LOCKED' && stage !== 'HIDDEN' && (
            <Button icon={<QuestionCircleOutlined />} onClick={() => onSave({ stage: 'QUESTIONED' })}>
              {t('entry.question')}
            </Button>
          )}
          {canEdit && stage === 'QUESTIONED' && <Button onClick={() => onSave({ stage: hasText ? 'TRANSLATED' : 'UNTRANSLATED' })}>{t('entry.unquestion')}</Button>}
          {canReview && (stage === 'TRANSLATED' || stage === 'QUESTIONED' || (stage === 'UNTRANSLATED' && hasText)) && (
            <Tooltip title={t('entry.reviewTip')}>
              <Button className="btn-success" icon={<CheckOutlined />} disabled={!hasText} onClick={() => onSave({ stage: 'REVIEWED', next: true })}>
                {t('entry.approve')}
              </Button>
            </Tooltip>
          )}
          {canReview && stage === 'REVIEWED' && <Button onClick={() => onSave({ stage: 'TRANSLATED' })}>{t('entry.unapprove')}</Button>}
          {moreItems.length > 0 && (
            <Dropdown menu={{ items: moreItems }} trigger={['click']}>
              <Button icon={<MoreOutlined />} />
            </Dropdown>
          )}
        </Space>
        <Space size={6} className="entry-credit">
          {entry.translator && (
            <span>
              <UserAvatar user={entry.translator} /> {t('entry.translatedBy')}
            </span>
          )}
          {entry.reviewer && (
            <span>
              <UserAvatar user={entry.reviewer} /> {t('entry.reviewedBy')}
            </span>
          )}
          <span className="muted small">{fromNow(entry.updatedAt)}</span>
        </Space>
      </div>

      <Tabs
        className="side-tabs"
        size="small"
        activeKey={props.sideTab === 'linked' && !linked.length ? 'tm' : props.sideTab}
        onChange={props.onSideTab}
        items={[
          { key: 'tm', label: t('side.tm'), children: <TMTab pid={pid} entry={entry} onUse={onDraft} canEdit={canEdit} /> },
          {
            key: 'terms',
            label: matched.length ? t('side.termsCount', { count: matched.length }) : t('side.terms'),
            children: <TermsTab matched={matched} onInsert={insert} canEdit={canEdit} />,
          },
          { key: 'context', label: t('side.context'), children: <ContextTab pid={pid} entry={entry} onJump={props.onJump} /> },
          { key: 'history', label: t('side.history'), children: <HistoryTab pid={pid} entry={entry} canEdit={canEdit} onRollback={props.onRollback} /> },
          ...(linked.length ? [{ key: 'linked', label: t('linked.tab', { count: linked.length }), children: <LinkedTab items={linked} onJump={props.onJump} /> }] : []),
        ]}
      />
    </div>
  );
});
