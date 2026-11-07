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
import { Alert, Button, Dropdown, Input, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { CATEGORY_LABELS, Engine, PERMISSIONS, Permission, Stage, missingControlCodes } from '@gametrans/shared';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import type { Entry, HistoryItem, Term } from '../api/types';
import { StageTag, UserAvatar } from '../components/Tags';
import { fromNow } from '../utils';
import { Highlighted, findTerms } from './highlight';
import { ContextTab, HistoryTab, TMTab, TermsTab } from './SidePanels';

export interface EntryPanelHandle {
  focus(): void;
  insert(text: string): void;
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
  sideTab: string;
  onSideTab: (k: string) => void;
}

const lines = (s: string) => (s === '' ? 0 : s.split('\n').length);

export const EntryPanel = forwardRef<EntryPanelHandle, Props>(function EntryPanel(props, ref) {
  const { pid, engine, entry, draft, onDraft, terms, has, canEdit, saving, onSave } = props;
  const taRef = useRef<TextAreaRef>(null);
  const dirty = draft !== entry.translation;

  const insert = (text: string) => {
    const el = taRef.current?.resizableTextArea?.textArea;
    if (!el) {
      onDraft(draft + text);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    onDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus({ cursor: 'end' }),
    insert,
  }));

  const { matched } = useMemo(() => findTerms(entry.original, terms), [entry.original, terms]);

  const warnings = useMemo(() => {
    const out: { type: 'warning' | 'info'; text: string }[] = [];
    if (!draft) return out;
    const missing = missingControlCodes(entry.original, draft);
    if (missing.length) out.push({ type: 'warning', text: `译文缺少控制符：${[...new Set(missing)].join(' ')}` });
    const lo = lines(entry.original);
    const lt = lines(draft);
    if (entry.category === 'dialogue') {
      if (engine === 'RMXP' && lt > 4) out.push({ type: 'warning', text: `XP 的对话框最多显示 4 行，当前译文 ${lt} 行` });
      else if (lt > lo) out.push({ type: 'info', text: `译文 ${lt} 行，多于原文 ${lo} 行（导出时会自动增加行，超出对话框高度会分页显示）` });
    }
    const lead = (s: string) => /^\s/.test(s);
    const trail = (s: string) => /\s$/.test(s);
    if (lead(entry.original) !== lead(draft) || trail(entry.original) !== trail(draft)) {
      out.push({ type: 'info', text: '首尾空白与原文不一致' });
    }
    for (const t of matched) {
      const hay = t.caseSensitive ? draft : draft.toLowerCase();
      const needle = t.caseSensitive ? t.translation : t.translation.toLowerCase();
      if (!hay.includes(needle)) out.push({ type: 'info', text: `术语「${t.term}」建议译为「${t.translation}」` });
    }
    return out;
  }, [draft, entry.original, entry.category, engine, matched]);

  const stage = entry.stage;
  const hasText = draft.trim() !== '';
  const readOnlyReason = !has(PERMISSIONS.TRANSLATE)
    ? '你没有翻译权限，只能浏览'
    : stage === 'REVIEWED'
      ? '该词条已审核，只有审核员及以上可以修改'
      : stage === 'LOCKED'
        ? '该词条已锁定，只有管理员可以修改'
        : stage === 'HIDDEN'
          ? '该词条已隐藏，只有管理员可以修改'
          : '';

  const moreItems = has(PERMISSIONS.MANAGE_ENTRIES)
    ? [
        stage === 'LOCKED'
          ? { key: 'unlock', icon: <UnlockOutlined />, label: '解锁', onClick: () => onSave({ stage: entry.translation || hasText ? 'REVIEWED' : 'UNTRANSLATED' }) }
          : { key: 'lock', icon: <LockOutlined />, label: '锁定', onClick: () => onSave({ stage: 'LOCKED' }) },
        stage === 'HIDDEN'
          ? { key: 'unhide', icon: <EyeOutlined />, label: '取消隐藏', onClick: () => onSave({ stage: hasText ? 'TRANSLATED' : 'UNTRANSLATED' }) }
          : { key: 'hide', icon: <EyeInvisibleOutlined />, label: '隐藏（不翻译）', onClick: () => onSave({ stage: 'HIDDEN' }) },
      ]
    : [];

  return (
    <div className="entry-panel">
      <div className="entry-meta">
        <Space size={6} wrap>
          <StageTag stage={stage} />
          <Tag bordered={false}>{CATEGORY_LABELS[entry.category] ?? entry.category}</Tag>
          <Typography.Text type="secondary" className="small" copyable={{ text: entry.key, tooltips: ['复制键名', '已复制'] }}>
            {entry.file.path} · {entry.key}
          </Typography.Text>
        </Space>
        <div className="entry-context">{entry.context}</div>
      </div>

      {entry.danger && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          className="entry-alert"
          message={
            entry.category === 'script'
              ? '脚本文本：请只翻译引号内显示给玩家的文字，保留 #{...}、%s、\\n 等代码与格式符，引号会自动转义。'
              : entry.category === 'plugin'
                ? '插件参数 / 指令：部分值是文件名、开关或代码，译错可能导致游戏报错，请确认是显示文本后再翻译。'
                : '备注（Note）通常由插件读取，请只翻译确定会显示给玩家的部分。'
          }
        />
      )}

      <div className="text-block">
        <div className="text-block-head">
          <span>原文</span>
          <Space size={2}>
            <span className="muted small">{entry.original.length} 字</span>
            {canEdit && (
              <Tooltip title="复制原文到译文（Alt+C）">
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
            译文 {dirty && <Tag color="orange" bordered={false}>未保存</Tag>}
          </span>
          <span className="muted small">{draft.length} 字</span>
        </div>
        <Input.TextArea
          ref={taRef}
          className="translation-input"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          autoSize={{ minRows: 4, maxRows: 16 }}
          disabled={!canEdit}
          placeholder={canEdit ? '输入译文…  Ctrl+Enter 保存并下一条' : readOnlyReason}
          spellCheck={false}
        />
        {!canEdit && readOnlyReason && (
          <Typography.Text type="secondary" className="small">
            {readOnlyReason}
          </Typography.Text>
        )}
        {warnings.length > 0 && (
          <div className="qa-list">
            {warnings.map((w, i) => (
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
                  保存并下一条
                </Button>
              </Tooltip>
              <Tooltip title="Ctrl+S">
                <Button loading={saving} disabled={!dirty} onClick={() => onSave()}>
                  保存
                </Button>
              </Tooltip>
            </>
          )}
          {canEdit && stage !== 'QUESTIONED' && stage !== 'LOCKED' && stage !== 'HIDDEN' && (
            <Button icon={<QuestionCircleOutlined />} onClick={() => onSave({ stage: 'QUESTIONED' })}>
              有疑问
            </Button>
          )}
          {canEdit && stage === 'QUESTIONED' && (
            <Button onClick={() => onSave({ stage: hasText ? 'TRANSLATED' : 'UNTRANSLATED' })}>取消疑问</Button>
          )}
          {has(PERMISSIONS.REVIEW) && (stage === 'TRANSLATED' || stage === 'QUESTIONED' || (stage === 'UNTRANSLATED' && hasText)) && (
            <Tooltip title="Ctrl+Shift+Enter 审核并下一条">
              <Button className="btn-success" icon={<CheckOutlined />} disabled={!hasText} onClick={() => onSave({ stage: 'REVIEWED', next: true })}>
                审核通过
              </Button>
            </Tooltip>
          )}
          {has(PERMISSIONS.REVIEW) && stage === 'REVIEWED' && <Button onClick={() => onSave({ stage: 'TRANSLATED' })}>取消审核</Button>}
          {moreItems.length > 0 && (
            <Dropdown menu={{ items: moreItems }} trigger={['click']}>
              <Button icon={<MoreOutlined />} />
            </Dropdown>
          )}
        </Space>
        <Space size={6} className="entry-credit">
          {entry.translator && (
            <span>
              <UserAvatar user={entry.translator} /> 翻译
            </span>
          )}
          {entry.reviewer && (
            <span>
              <UserAvatar user={entry.reviewer} /> 审核
            </span>
          )}
          <span className="muted small">{fromNow(entry.updatedAt)}</span>
        </Space>
      </div>

      <Tabs
        className="side-tabs"
        size="small"
        activeKey={props.sideTab}
        onChange={props.onSideTab}
        items={[
          {
            key: 'tm',
            label: '翻译记忆',
            children: <TMTab pid={pid} entry={entry} onUse={(t) => onDraft(t)} canEdit={canEdit} />,
          },
          {
            key: 'terms',
            label: `术语${matched.length ? ` (${matched.length})` : ''}`,
            children: <TermsTab matched={matched} onInsert={insert} canEdit={canEdit} />,
          },
          { key: 'context', label: '上下文', children: <ContextTab pid={pid} entry={entry} onJump={props.onJump} /> },
          {
            key: 'history',
            label: '历史',
            children: <HistoryTab pid={pid} entry={entry} canEdit={canEdit} onRollback={props.onRollback} />,
          },
        ]}
      />
    </div>
  );
});
