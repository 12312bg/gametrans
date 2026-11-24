import { BulbOutlined, DeleteOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Empty, Input, InputNumber, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { TWINE_RULE_CATEGORIES, TwineMacroRule, TwineRuleCategory } from '@gametrans/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useT } from '../../i18n';
import { errorMessage } from '../../utils';

interface RulesResponse {
  builtin: TwineMacroRule[];
  macros: TwineMacroRule[];
}

interface MacroStat {
  name: string;
  uses: number;
  defined: boolean;
  args: { i: number; strings: number; prose: number; distinct: number; samples: string[] }[];
  suggested: TwineMacroRule | null;
}

/** 编辑中的规则：参数写成文本（"1, 2" 或 "all"），保存时再转换 */
interface Row {
  id: number;
  name: string;
  args: string;
  speaker: number | null;
  category: TwineRuleCategory;
}

let seq = 0;
const toRow = (r: TwineMacroRule): Row => ({
  id: ++seq,
  name: r.name,
  args: r.args === 'all' ? 'all' : r.args.join(', '),
  speaker: r.speaker ?? null,
  category: r.category ?? 'dialogue',
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
  return { name: r.name.trim(), args, ...(r.speaker !== null ? { speaker: r.speaker } : {}), ...(r.category !== 'dialogue' ? { category: r.category } : {}) };
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
  const rules = useQuery({ queryKey: ['twineRules', pid], queryFn: () => api<RulesResponse>(`/projects/${pid}/twine/rules`) });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<{ files: number; macros: MacroStat[] } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (rules.data && rows === null) setRows(rules.data.macros.map(toRow));
  }, [rules.data, rows]);

  const current = rows ?? [];
  const invalid = current.filter((r) => toRule(r) === null).map((r) => r.id);
  const names = current.map((r) => r.name.trim());
  const duplicate = new Set(names.filter((n, i) => n && names.indexOf(n) !== i));
  const dirty = useMemo(() => {
    const saved = JSON.stringify(rules.data?.macros ?? []);
    return rows !== null && JSON.stringify(rows.map(toRule)) !== saved;
  }, [rows, rules.data]);

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const adopt = (list: TwineMacroRule[]) =>
    setRows((rs) => {
      const out = [...(rs ?? [])];
      for (const r of list) {
        const at = out.findIndex((x) => x.name.trim() === r.name);
        if (at >= 0) out[at] = { ...toRow(r), id: out[at].id };
        else out.push(toRow(r));
      }
      return out;
    });

  const analyze = async () => {
    setAnalyzing(true);
    try {
      setAnalysis(await api<{ files: number; macros: MacroStat[] }>(`/projects/${pid}/twine/macros`));
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    const list = current.map(toRule);
    if (list.some((r) => r === null) || duplicate.size) return message.error(t('twine.invalid'));
    setSaving(true);
    try {
      const r = await api<RulesResponse>(`/projects/${pid}/twine/rules`, { method: 'PUT', body: { macros: list } });
      qc.setQueryData(['twineRules', pid], r);
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

  const categoryOptions = TWINE_RULE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }));
  const suggestions = analysis?.macros.filter((m) => m.suggested) ?? [];

  return (
    <Card
      variant="borderless"
      title={t('twine.title')}
      extra={
        <Space>
          <Button icon={<SearchOutlined />} loading={analyzing} onClick={analyze}>
            {t('twine.analyze')}
          </Button>
          <Button type="primary" onClick={save} loading={saving} disabled={!dirty}>
            {t('common.save')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" className="small">
        {t('twine.desc')}
      </Typography.Paragraph>

      {analysis && (
        <div className="twine-analysis" style={{ marginBottom: 16 }}>
          <Space style={{ marginBottom: 8 }} wrap>
            <BulbOutlined />
            <span>{t('twine.analyzed', { files: analysis.files, macros: analysis.macros.length, suggested: suggestions.length })}</span>
            {suggestions.length > 0 && (
              <Button size="small" onClick={() => adopt(suggestions.map((m) => m.suggested!))}>
                {t('twine.adoptAll')}
              </Button>
            )}
          </Space>
          <Table<MacroStat>
            size="small"
            rowKey="name"
            dataSource={analysis.macros}
            pagination={analysis.macros.length > 10 ? { pageSize: 10, size: 'small' } : false}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('twine.noMacros')} /> }}
            columns={[
              {
                title: t('twine.macro'),
                dataIndex: 'name',
                width: 160,
                render: (n: string, m) => (
                  <Space size={4} wrap>
                    <code>{`<<${n}>>`}</code>
                    {m.defined && (
                      <Tooltip title={t('twine.definedTip')}>
                        <Tag bordered={false}>{t('twine.defined')}</Tag>
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
              { title: t('twine.uses'), dataIndex: 'uses', width: 70 },
              {
                title: t('twine.samples'),
                render: (_, m) => (
                  <div className="small">
                    {m.args
                      .filter((a) => a.samples.length)
                      .slice(0, 3)
                      .map((a) => (
                        <div key={a.i} className="ellipsis">
                          <Tag bordered={false}>#{a.i}</Tag>
                          <span className="muted">{a.samples[0]}</span>
                        </div>
                      ))}
                  </div>
                ),
              },
              {
                title: t('twine.suggested'),
                width: 220,
                render: (_, m) =>
                  m.suggested ? (
                    <Space size={4} wrap>
                      <span className="small">
                        {t('twine.argsShort', { args: ruleText(m.suggested) })}
                        {m.suggested.speaker !== undefined ? ` · ${t('twine.speakerShort', { i: m.suggested.speaker })}` : ''}
                      </span>
                      <Button size="small" type="link" onClick={() => adopt([m.suggested!])}>
                        {t('twine.adopt')}
                      </Button>
                    </Space>
                  ) : (
                    <Button size="small" type="link" onClick={() => adopt([{ name: m.name, args: [m.args.find((a) => a.strings)?.i ?? 0] }])}>
                      {t('twine.addManually')}
                    </Button>
                  ),
              },
            ]}
          />
        </div>
      )}

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
            render: (_, r) => <Select size="small" style={{ width: 110 }} value={r.category} options={categoryOptions} onChange={(v) => update(r.id, { category: v })} />,
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
    </Card>
  );
}
