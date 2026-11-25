import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Empty, Input, InputNumber, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { TWINE_RULE_CATEGORIES, TwineMacroRule, TwineRuleCategory } from '@gametrans/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useT } from '../../i18n';
import { errorMessage } from '../../utils';
import { RulesResponse, useTwineRules } from './twine/api';
import { TwineMacroReview } from './twine/TwineMacroReview';

/** 编辑中的规则：参数写成文本（"1, 2" 或 "all"），保存时再转换 */
interface Row {
  id: number;
  name: string;
  args: string;
  speaker: number | null;
  category: TwineRuleCategory | 'auto';
  /** 分隔符：手动编辑中不显示，原样保留 */
  split?: string[];
}

let seq = 0;
const toRow = (r: TwineMacroRule): Row => ({
  id: ++seq,
  name: r.name,
  args: r.args === 'all' ? 'all' : r.args.join(', '),
  speaker: r.speaker ?? null,
  category: r.category ?? 'auto',
  ...(r.split?.length ? { split: r.split } : {}),
});

/** "1, 2" → [1, 2]；"all" → 'all'；格式不对返回 null */
export function parseArgs(text: string): number[] | 'all' | null {
  const v = text.trim().toLowerCase();
  if (v === 'all' || v === '*') return 'all';
  if (!v) return [];
  const parts = v.split(/[\s,，、]+/).filter(Boolean);
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  return [...new Set(parts.map(Number))].sort((a, b) => a - b);
}

const toRule = (r: Row): TwineMacroRule | null => {
  const args = parseArgs(r.args);
  if (args === null || !r.name.trim()) return null;
  return {
    name: r.name.trim(),
    args,
    ...(r.speaker !== null ? { speaker: r.speaker } : {}),
    ...(r.category !== 'auto' ? { category: r.category } : {}),
    ...(r.split?.length ? { split: r.split } : {}),
  };
};

const ruleText = (r: TwineMacroRule) => (r.args === 'all' ? 'all' : r.args.join(', ') || '—');

/**
 * Twine 项目的宏规则：哪个宏的第几个参数是显示文字、第几个参数是说话人。
 * 可以分析已上传的故事，一键采用推荐；保存后重新提取才会生效。
 */
export function TwineRulesCard({ pid }: { pid: string }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { message, modal } = App.useApp();
  const rules = useTwineRules(pid);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);

  // 规则在「确认自定义宏」中保存后同步过来
  useEffect(() => {
    if (rules.data) setRows(rules.data.macros.map(toRow));
  }, [rules.data]);

  const current = rows ?? [];
  const invalid = current.filter((r) => toRule(r) === null).map((r) => r.id);
  const names = current.map((r) => r.name.trim());
  const duplicate = new Set(names.filter((n, i) => n && names.indexOf(n) !== i));
  const dirty = useMemo(() => {
    const saved = JSON.stringify(rules.data?.macros ?? []);
    return rows !== null && JSON.stringify(rows.map(toRule)) !== saved;
  }, [rows, rules.data]);

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const unignore = async (name: string) => {
    try {
      const r = await api<RulesResponse>(`/projects/${pid}/twine/rules`, { method: 'PUT', body: { macros: rules.data!.macros, ignored: rules.data!.ignored.filter((n) => n !== name) } });
      qc.setQueryData(['twineRules', pid], r);
      qc.invalidateQueries({ queryKey: ['twineMacros', pid] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const save = async () => {
    const list = current.map(toRule);
    if (list.some((r) => r === null) || duplicate.size) return message.error(t('twine.invalid'));
    setSaving(true);
    try {
      const r = await api<RulesResponse>(`/projects/${pid}/twine/rules`, { method: 'PUT', body: { macros: list } });
      qc.setQueryData(['twineRules', pid], r);
      qc.invalidateQueries({ queryKey: ['twineMacros', pid] });
      setRows(r.macros.map(toRow));
      modal.confirm({
        title: t('twine.saved'),
        content: t('twine.reextractAsk'),
        okText: t('twine.reextract'),
        cancelText: t('twine.later'),
        onOk: async () => {
          try {
            await api(`/projects/${pid}/files/reextract`, { method: 'POST' });
            message.success(t('files.reextractStarted'));
            nav(`/projects/${pid}/files`);
          } catch (e) {
            message.error(errorMessage(e));
          }
        },
      });
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = [{ value: 'auto' as const, label: t('twine.categoryAuto') }, ...TWINE_RULE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))];

  const manual = (
    <div>
      <Space style={{ marginBottom: 8, width: '100%', justifyContent: 'space-between' }}>
        <Typography.Text type="secondary" className="small">
          {t('twine.manualDesc')}
        </Typography.Text>
        <Button type="primary" size="small" onClick={save} loading={saving} disabled={!dirty}>
          {t('common.save')}
        </Button>
      </Space>

      <Table<Row>
        size="small"
        rowKey="id"
        loading={rules.isLoading}
        dataSource={current}
        pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('twine.empty')} /> }}
        columns={[
          {
            title: t('twine.macro'),
            width: 180,
            render: (_, r) => (
              <Input
                size="small"
                prefix="<<"
                suffix=">>"
                value={r.name}
                status={!r.name.trim() || duplicate.has(r.name.trim()) ? 'error' : undefined}
                onChange={(e) => update(r.id, { name: e.target.value })}
                aria-label={t('twine.macro')}
              />
            ),
          },
          {
            title: (
              <Tooltip title={t('twine.argsTip')}>
                <span>{t('twine.args')}</span>
              </Tooltip>
            ),
            width: 150,
            render: (_, r) => (
              <Input
                size="small"
                value={r.args}
                placeholder="0, 1 / all"
                status={invalid.includes(r.id) && r.name.trim() ? 'error' : undefined}
                onChange={(e) => update(r.id, { args: e.target.value })}
                aria-label={t('twine.args')}
              />
            ),
          },
          {
            title: (
              <Tooltip title={t('twine.speakerTip')}>
                <span>{t('twine.speaker')}</span>
              </Tooltip>
            ),
            width: 110,
            render: (_, r) => (
              <InputNumber size="small" min={0} max={31} value={r.speaker} onChange={(v) => update(r.id, { speaker: v ?? null })} aria-label={t('twine.speaker')} />
            ),
          },
          {
            title: t('twine.category'),
            width: 130,
            render: (_, r) => <Select size="small" style={{ width: 150 }} value={r.category} options={categoryOptions} onChange={(v) => update(r.id, { category: v })} />,
          },
          {
            width: 48,
            render: (_, r) => (
              <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={t('common.delete')} onClick={() => setRows((rs) => (rs ?? []).filter((x) => x.id !== r.id))} />
            ),
          },
        ]}
      />
      <Button style={{ marginTop: 8 }} size="small" icon={<PlusOutlined />} onClick={() => setRows((rs) => [...(rs ?? []), toRow({ name: '', args: [0] })])}>
        {t('twine.add')}
      </Button>

      {rules.data && (
        <div style={{ marginTop: 16 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>
            {t('twine.builtin')}
          </div>
          <Space size={[4, 4]} wrap>
            {rules.data.builtin.map((r) => (
              <Tag key={r.name} bordered={false}>
                <code>{`<<${r.name}>>`}</code> {ruleText(r)}
              </Tag>
            ))}
          </Space>
        </div>
      )}
      {(rules.data?.ignored.length ?? 0) > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="muted small" style={{ marginBottom: 4 }}>
            {t('twine.ignoredList')}
          </div>
          <Space size={[4, 4]} wrap>
            {rules.data!.ignored.map((n) => (
              <Tag key={n} bordered={false} closable onClose={(e) => (e.preventDefault(), unignore(n))}>
                <code>{`<<${n}>>`}</code>
              </Tag>
            ))}
          </Space>
        </div>
      )}
    </div>
  );

  return (
    <Card variant="borderless" title={t('twine.title')} id="twine-rules">
      <Typography.Paragraph type="secondary" className="small">
        {t('twine.desc')}
      </Typography.Paragraph>
      <Tabs
        size="small"
        items={[
          { key: 'review', label: t('twine.tab.review'), children: <TwineMacroReview pid={pid} /> },
          { key: 'manual', label: t('twine.tab.manual'), children: manual },
        ]}
      />
    </Card>
  );
}
