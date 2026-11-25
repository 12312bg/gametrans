import { CheckOutlined, StopOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Checkbox, Empty, Input, List, Segmented, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { TWINE_RULE_CATEGORIES, TwineArgStat, TwineArgVerdict, TwineConfig, TwineMacroRule, TwineRuleCategory } from '@gametrans/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client';
import { TFn, useT } from '../../../i18n';
import { errorMessage } from '../../../utils';
import { AnalyzedMacro, PreviewResponse, useTwineAnalysis, useTwineRules } from './api';

export type Choice = 'translate' | 'speaker' | 'skip';

export interface Decision {
  choices: Record<number, Choice>;
  /** 按检测到的分隔符拆成多条词条 */
  split: boolean;
  /** auto：有说话人时为对话，否则为正文 */
  category: TwineRuleCategory | 'auto';
  /** 要提取的带前缀文字（如 response:） */
  prefixes: string[];
}

const VERDICT_COLOR: Record<TwineArgVerdict, string> = { display: 'green', logic: 'red', stored: 'orange', unknown: 'default' };

/** 由已保存的规则或推荐得到初始选择 */
export function initialDecision(m: AnalyzedMacro, saved: TwineMacroRule | undefined, ignored: boolean): Decision {
  const choices: Record<number, Choice> = {};
  const rule = saved ?? (ignored ? undefined : m.suggested ?? undefined);
  for (const a of m.args) {
    const on = rule && (rule.args === 'all' ? a.strings > 0 : rule.args.includes(a.i));
    choices[a.i] = rule?.speaker === a.i ? 'speaker' : on ? 'translate' : 'skip';
  }
  return { choices, split: saved ? !!saved.split?.length : !!m.suggested?.split?.length, category: rule?.category ?? 'auto', prefixes: rule?.prefixes ?? [] };
}

/** 选择 → 规则；没有要翻译的参数时返回 null（记为「不翻译」） */
export function ruleOf(m: AnalyzedMacro, d: Decision): TwineMacroRule | null {
  const args = Object.entries(d.choices)
    .filter(([, c]) => c === 'translate')
    .map(([i]) => Number(i))
    .sort((a, b) => a - b);
  const prefixes = d.prefixes.filter(Boolean);
  if (!args.length && !prefixes.length) return null;
  const sp = Object.entries(d.choices).find(([, c]) => c === 'speaker');
  // 分隔符取自要翻译的参数；只提取带前缀文字时取自所有参数
  const from = args.length ? m.args.filter((a) => args.includes(a.i)) : m.args;
  const split = d.split ? [...new Set(from.flatMap((a) => a.split ?? []))] : [];
  return {
    name: m.name,
    args,
    ...(sp ? { speaker: Number(sp[0]) } : {}),
    ...(d.category !== 'auto' ? { category: d.category } : {}),
    ...(split.length ? { split } : {}),
    ...(prefixes.length ? { prefixes } : {}),
  };
}

/** 合并为要保存的配置：未分析到的宏保留原有规则 / 不翻译标记 */
export function buildConfig(macros: AnalyzedMacro[], decisions: Record<string, Decision>, saved: TwineMacroRule[], savedIgnored: string[]): TwineConfig {
  const analyzed = new Set(macros.map((m) => m.name));
  const rules = saved.filter((r) => !analyzed.has(r.name));
  const ignored = savedIgnored.filter((n) => !analyzed.has(n));
  for (const m of macros) {
    const r = ruleOf(m, decisions[m.name]);
    if (r) rules.push(r);
    else ignored.push(m.name);
  }
  return { macros: rules, ignored: [...new Set(ignored)].sort() };
}

function EvidenceList({ arg, t }: { arg: TwineArgStat; t: TFn }) {
  if (!arg.evidence.length) return <span className="muted small">{t('twine.ev.none')}</span>;
  return (
    <div className="twine-evidence">
      {arg.evidence.map((e, k) => (
        <div key={k} className="small">
          <span className={/compare|key|target|markup|path|storedKey/.test(e.kind) ? 'ev-logic' : 'ev-display'}>{t(`twine.ev.${e.kind}`, { via: e.via ?? '' })}</span>{' '}
          <code className="muted">{e.code}</code>
        </div>
      ))}
    </div>
  );
}

type Filter = 'pending' | 'suggested' | 'all' | 'ignored';

/**
 * 确认自定义宏：每个参数选择「翻译 / 说话人 / 不翻译」，显示判断依据、示例与预计提取的词条数；
 * 保存后重新提取。没有选择翻译的宏记为「不翻译」，以后分析不再提示。
 */
export function TwineMacroReview({ pid }: { pid: string }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { message } = App.useApp();
  const rules = useTwineRules(pid);
  const analysis = useTwineAnalysis(pid);
  const [decisions, setDecisions] = useState<Record<string, Decision> | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const macros = analysis.data?.macros ?? [];
  // 规则或分析结果更新后（如在「手动编辑」中保存、上传了新版本），重新初始化选择
  useEffect(() => setDecisions(null), [rules.dataUpdatedAt, analysis.dataUpdatedAt]);
  useEffect(() => {
    if (!rules.data || !analysis.data || decisions) return;
    const saved = new Map(rules.data.macros.map((r) => [r.name, r]));
    const ignored = new Set(rules.data.ignored);
    setDecisions(Object.fromEntries(analysis.data.macros.map((m) => [m.name, initialDecision(m, saved.get(m.name), ignored.has(m.name))])));
    setFilter(analysis.data.pending.length ? 'pending' : 'all');
  }, [rules.data, analysis.data, decisions]);

  const config = useMemo(
    () => (decisions && rules.data ? buildConfig(macros, decisions, rules.data.macros, rules.data.ignored) : null),
    [decisions, macros, rules.data],
  );
  const configKey = config ? JSON.stringify(config) : '';
  const dirty = !!config && !!rules.data && JSON.stringify({ macros: rules.data.macros, ignored: rules.data.ignored }) !== JSON.stringify({ macros: config.macros, ignored: config.ignored ?? [] });

  // 选择变化后预览效果（防抖）
  useEffect(() => {
    if (!config) return;
    const n = ++seq.current;
    setPreviewing(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api<PreviewResponse>(`/projects/${pid}/twine/preview`, { method: 'POST', body: config });
        if (n === seq.current) setPreview(r);
      } catch {
        // 预览失败不影响保存
      } finally {
        if (n === seq.current) setPreviewing(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, pid]);

  if (analysis.isLoading || rules.isLoading || !decisions) {
    return (
      <div className="center-spin" style={{ padding: 32 }}>
        <Spin tip={t('twine.analyzing')}>
          <div style={{ width: 200, height: 40 }} />
        </Spin>
      </div>
    );
  }
  if (analysis.error) return <Typography.Text type="danger">{errorMessage(analysis.error)}</Typography.Text>;

  const pending = new Set(analysis.data?.pending ?? []);
  const update = (name: string, patch: Partial<Decision>) => setDecisions((d) => ({ ...d!, [name]: { ...d![name], ...patch } }));
  const choose = (m: AnalyzedMacro, i: number, c: Choice) => {
    const choices = { ...decisions[m.name].choices };
    // 说话人只能有一个
    if (c === 'speaker') for (const k of Object.keys(choices)) if (choices[Number(k)] === 'speaker') choices[Number(k)] = 'skip';
    choices[i] = c;
    update(m.name, { choices });
  };
  const translating = (m: AnalyzedMacro) => Object.values(decisions[m.name].choices).includes('translate') || decisions[m.name].prefixes.length > 0;

  const shown = macros.filter((m) => {
    if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'pending') return pending.has(m.name);
    if (filter === 'suggested') return !!m.suggested;
    if (filter === 'ignored') return !translating(m);
    return true;
  });

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api(`/projects/${pid}/twine/rules`, { method: 'PUT', body: config });
      await api(`/projects/${pid}/files/reextract`, { method: 'POST' });
      message.success(t('twine.savedReextract'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['twineRules', pid] }), qc.invalidateQueries({ queryKey: ['twineMacros', pid] })]);
      setDecisions(null);
      nav(`/projects/${pid}/files`);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const counts = {
    pending: pending.size,
    suggested: macros.filter((m) => m.suggested).length,
    all: macros.length,
    ignored: macros.filter((m) => !translating(m)).length,
  };

  return (
    <div className="twine-review">
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented<Filter>
          value={filter ?? 'all'}
          onChange={setFilter}
          options={(['pending', 'suggested', 'all', 'ignored'] as Filter[]).map((f) => ({ value: f, label: `${t(`twine.filter.${f}`)} ${counts[f]}` }))}
        />
        <Input.Search allowClear size="small" placeholder={t('twine.searchMacro')} style={{ width: 200 }} onChange={(e) => setQ(e.target.value)} />
      </Space>

      <List<AnalyzedMacro>
        dataSource={shown}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(filter === 'pending' ? 'twine.noPending' : 'twine.noMacros')} /> }}
        pagination={shown.length > 8 ? { pageSize: 8, size: 'small', showSizeChanger: false } : false}
        renderItem={(m) => {
          const d = decisions[m.name];
          const per = preview?.perMacro[m.name];
          const splits = [...new Set(m.args.flatMap((a) => a.split ?? []))];
          return (
            <List.Item className="twine-macro" data-macro={m.name}>
              <div style={{ width: '100%' }}>
                <div className="twine-macro-head">
                  <Space size={6} wrap>
                    <code className="twine-macro-name">{`<<${m.name}>>`}</code>
                    <Tag bordered={false} color={pending.has(m.name) ? 'gold' : m.status === 'configured' ? 'blue' : undefined}>
                      {t(pending.has(m.name) ? 'twine.status.pending' : `twine.status.${m.status}`)}
                    </Tag>
                    <Tooltip title={t(`twine.confidenceTip.${m.confidence}`)}>
                      <Tag bordered={false} color={m.confidence === 'high' ? 'green' : 'orange'}>
                        {t(`twine.confidence.${m.confidence}`)}
                      </Tag>
                    </Tooltip>
                    <span className="muted small">{t(`twine.source.${m.source}`)}</span>
                    <span className="muted small">{t('twine.usesCount', { count: m.uses })}</span>
                    {translating(m) && (
                      <span className="small">{per ? t('twine.willExtract', { count: per.count }) : previewing ? '…' : t('twine.willExtract', { count: 0 })}</span>
                    )}
                  </Space>
                  <Space size={4}>
                    {m.suggested && (
                      <Button size="small" icon={<CheckOutlined />} onClick={() => update(m.name, initialDecision({ ...m }, undefined, false))}>
                        {t('twine.useSuggested')}
                      </Button>
                    )}
                    <Button
                      size="small"
                      icon={<StopOutlined />}
                      onClick={() => update(m.name, { choices: Object.fromEntries(m.args.map((a) => [a.i, 'skip' as Choice])), prefixes: [] })}
                    >
                      {t('twine.skipAll')}
                    </Button>
                  </Space>
                </div>
                <div className="twine-args">
                  {m.args.map((a) => (
                    <div key={a.i} className="twine-arg">
                      <div className="twine-arg-meta">
                        <Tag bordered={false}>#{a.i}</Tag>
                        <Tooltip title={t(`twine.verdictTip.${a.verdict}`)}>
                          <Tag color={VERDICT_COLOR[a.verdict]} bordered={false}>
                            {t(`twine.verdict.${a.verdict}`)}
                          </Tag>
                        </Tooltip>
                        <span className="muted small">{a.strings ? t('twine.stringsCount', { count: a.strings }) : t('twine.distinctCount', { count: a.distinct })}</span>
                      </div>
                      <div className="twine-arg-body">
                        {a.samples.length > 0 && (
                          <div className="twine-samples">
                            {a.samples.map((s, k) => (
                              <div key={k} className="small ellipsis" title={s}>
                                “{s}”
                              </div>
                            ))}
                          </div>
                        )}
                        <EvidenceList arg={a} t={t} />
                      </div>
                      <Segmented<Choice>
                        size="small"
                        value={d.choices[a.i] ?? 'skip'}
                        onChange={(c) => choose(m, a.i, c)}
                        options={[
                          { value: 'translate', label: t('twine.choice.translate'), disabled: !a.strings },
                          { value: 'speaker', label: t('twine.choice.speaker') },
                          { value: 'skip', label: t('twine.choice.skip') },
                        ]}
                        aria-label={`${m.name} #${a.i}`}
                      />
                    </div>
                  ))}
                </div>
                {m.prefixes.length > 0 && (
                  <div className="twine-prefixes">
                    <Tooltip title={t('twine.prefixTip')}>
                      <div className="muted small">{t('twine.prefixTitle')}</div>
                    </Tooltip>
                    {m.prefixes.map((x) => (
                      <div key={x.prefix} className="twine-prefix">
                        <Checkbox
                          checked={d.prefixes.includes(x.prefix)}
                          onChange={(e) => update(m.name, { prefixes: e.target.checked ? [...d.prefixes, x.prefix] : d.prefixes.filter((p) => p !== x.prefix) })}
                          aria-label={`${m.name} ${x.prefix}`}
                        >
                          <code>{x.prefix}</code> <span className="muted small">{t('twine.prefixCount', { count: x.count, prose: x.prose })}</span>
                        </Checkbox>
                        {x.samples[0] && (
                          <span className="small ellipsis muted" title={x.samples[0]}>
                            “{x.samples[0]}”
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {translating(m) && (
                  <Space size={12} wrap className="twine-macro-foot">
                    {splits.length > 0 && (
                      <Checkbox checked={d.split} onChange={(e) => update(m.name, { split: e.target.checked })}>
                        {t('twine.splitBy', { seps: splits.map((s) => `“${s}”`).join(' ') })}
                      </Checkbox>
                    )}
                    <Space size={4}>
                      <span className="muted small">{t('twine.category')}</span>
                      <Select
                        size="small"
                        style={{ width: 150 }}
                        value={d.category}
                        onChange={(v) => update(m.name, { category: v })}
                        options={[{ value: 'auto' as const, label: t('twine.categoryAuto') }, ...TWINE_RULE_CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))]}
                      />
                    </Space>
                    {per?.samples.length ? (
                      <span className="muted small ellipsis" style={{ maxWidth: 420 }}>
                        {t('twine.previewSample', { text: per.samples[0] })}
                      </span>
                    ) : null}
                  </Space>
                )}
              </div>
            </List.Item>
          );
        }}
      />

      <div className="twine-review-foot">
        <span className="small">
          {preview
            ? t('twine.previewSummary', { total: preview.total, added: preview.added, removed: preview.removed })
            : previewing
              ? t('twine.previewing')
              : ''}
        </span>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={save}>
          {t('twine.saveReextract')}
        </Button>
      </div>
    </div>
  );
}
