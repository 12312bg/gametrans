import { ClearOutlined, DownOutlined, FileSearchOutlined, QuestionCircleOutlined, ReloadOutlined, SelectOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Button, Checkbox, Dropdown, Input, Popover, Select, Space, Tooltip, Typography } from 'antd';
import { BatchAction, ENTRY_CATEGORIES, STAGES } from '@gametrans/shared';
import { useEffect, useState } from 'react';
import type { FileItem } from '../../../api/types';
import { StageDot } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { progressOf } from '../../../utils';
import { SHORTCUTS } from './useShortcuts';

export interface EntryFilter {
  fileId: string;
  stage: string;
  category: string;
  q: string;
  field: string;
}

type SetParam = (patch: Record<string, string | null | undefined>) => void;

const SEARCH_FIELDS = ['all', 'original', 'translation', 'key', 'context'];
const split = (v: string) => (v ? v.split(',') : []);

interface ToolbarProps {
  filter: EntryFilter;
  setParam: SetParam;
  files: FileItem[];
  canFill: boolean;
  onFill: () => void;
  /** 批量替换译文（审核员及以上） */
  onReplace?: () => void;
  canBatch: boolean;
  batchMode: boolean;
  onToggleBatch: () => void;
  onRefresh: () => void;
}

export function EditorToolbar({ filter, setParam, files, canFill, onFill, onReplace, canBatch, batchMode, onToggleBatch, onRefresh }: ToolbarProps) {
  const t = useT();
  const [search, setSearch] = useState(filter.q);
  useEffect(() => setSearch(filter.q), [filter.q]);

  return (
    <div className="editor-toolbar">
      <Space wrap size={8}>
        <Select
          style={{ width: 240 }}
          placeholder={t('editor.allFiles')}
          allowClear
          showSearch
          value={filter.fileId || undefined}
          onChange={(v) => setParam({ file: v })}
          options={files.map((f) => ({
            value: f.id,
            searchText: f.path,
            label: (
              <div className="file-option">
                <span>{f.path}</span>
                <span className="muted small">{progressOf(f.stats).translatedPct}%</span>
              </div>
            ),
          }))}
          filterOption={(input, opt) => (opt?.searchText ?? '').toLowerCase().includes(input.toLowerCase())}
          popupMatchSelectWidth={360}
        />
        <Select
          mode="multiple"
          // 固定宽度：选中较长的选项（如「地图名（编辑器）」）时不改变工具栏布局，避免换行与跳动
          style={{ width: 170 }}
          popupMatchSelectWidth={220}
          maxTagCount="responsive"
          placeholder={t('editor.allStages')}
          allowClear
          value={split(filter.stage)}
          onChange={(v: string[]) => setParam({ stage: v.join(',') })}
          options={STAGES.map((s) => ({
            value: s,
            label: (
              <Space size={6}>
                <StageDot stage={s} />
                {t(`stage.${s}`)}
              </Space>
            ),
          }))}
        />
        <Select
          mode="multiple"
          style={{ width: 170 }}
          popupMatchSelectWidth={220}
          maxTagCount="responsive"
          placeholder={t('editor.allCategories')}
          allowClear
          value={split(filter.category)}
          onChange={(v: string[]) => setParam({ category: v.join(',') })}
          options={ENTRY_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))}
        />
        <Space.Compact>
          <Select
            style={{ width: 96 }}
            value={filter.field}
            onChange={(v) => setParam({ field: v === 'all' ? null : v })}
            options={SEARCH_FIELDS.map((f) => ({ value: f, label: t(`editor.field.${f}`) }))}
          />
          <Input.Search
            style={{ width: 220 }}
            allowClear
            placeholder={t('editor.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(v) => setParam({ q: v.trim() || null })}
          />
        </Space.Compact>
        {(filter.fileId || filter.stage || filter.category || filter.q) && (
          <Button icon={<ClearOutlined />} onClick={() => setParam({ file: null, stage: null, category: null, q: null, field: null })}>
            {t('editor.clearFilters')}
          </Button>
        )}
      </Space>
      <Space wrap size={8}>
        {canFill && (
          <Tooltip title={t('editor.fillTip')}>
            <Button icon={<ThunderboltOutlined />} onClick={onFill}>
              {t('editor.fill')}
            </Button>
          </Tooltip>
        )}
        {onReplace && (
          <Button icon={<FileSearchOutlined />} onClick={onReplace}>
            {t('replace.open')}
          </Button>
        )}
        {canBatch && (
          <Button type={batchMode ? 'primary' : 'default'} ghost={batchMode} icon={<SelectOutlined />} onClick={onToggleBatch}>
            {t('editor.batch')}
          </Button>
        )}
        <Tooltip title={t('common.refresh')}>
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
        </Tooltip>
        <Popover
          placement="bottomRight"
          title={t('editor.shortcuts')}
          content={
            <table className="shortcut-table">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{t(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <Button icon={<QuestionCircleOutlined />} />
        </Popover>
      </Space>
    </div>
  );
}

interface BatchBarProps {
  actions: BatchAction[];
  pageIds: string[];
  checked: Set<string>;
  onChecked: (s: Set<string>) => void;
  total: number;
  onRun: (action: BatchAction, scope: 'selected' | 'all') => void;
}

export function BatchBar({ actions, pageIds, checked, onChecked, total, onRun }: BatchBarProps) {
  const t = useT();
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));
  const menu = (scope: 'selected' | 'all') => ({
    items: actions.map((a) => ({ key: a, label: t(`batch.${a}`), danger: a === 'clear', onClick: () => onRun(a, scope) })),
  });
  return (
    <div className="batch-bar">
      <Checkbox
        checked={allChecked}
        indeterminate={!allChecked && pageIds.some((id) => checked.has(id))}
        onChange={(e) => {
          const next = new Set(checked);
          for (const id of pageIds) {
            if (e.target.checked) next.add(id);
            else next.delete(id);
          }
          onChecked(next);
        }}
      >
        {t('editor.selectPage')}
      </Checkbox>
      <Typography.Text type="secondary">{t('editor.selected', { count: checked.size })}</Typography.Text>
      <Dropdown disabled={!checked.size} menu={menu('selected')}>
        <Button size="small" type="primary" disabled={!checked.size}>
          {t('editor.batchSelected')} <DownOutlined />
        </Button>
      </Dropdown>
      <Dropdown menu={menu('all')}>
        <Button size="small">
          {t('editor.batchAll', { count: total.toLocaleString() })} <DownOutlined />
        </Button>
      </Dropdown>
    </div>
  );
}
