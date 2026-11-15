import { ApartmentOutlined, BranchesOutlined, UserOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Tag, Tooltip, Typography } from 'antd';
import type { BranchStep, Stage } from '@gametrans/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { StageDot } from '../../../components/Tags';
import { TFn, useT } from '../../../i18n';
import { CodesOnly } from './highlight';
import { ChoiceGroup, buildScene, selectionFor } from './sceneModel';

export interface SceneItem {
  id: string;
  key: string;
  original: string;
  translation: string;
  stage: Stage;
  version: number;
  category: string;
  branch: BranchStep[] | null;
  speaker: { name?: string; face?: string } | null;
  current: boolean;
}

export interface SceneData {
  scene: { fileId: string; path: string; prefix: string; title: string; truncated: boolean } | null;
  items: SceneItem[];
}

export function useScene(pid: string, entryId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['scene', entryId],
    queryFn: () => api<SceneData>(`/projects/${pid}/entries/${entryId}/scene`),
    staleTime: 30_000,
    enabled: enabled && !!entryId,
    // 切换词条时保留上一段事件，避免右栏闪烁、丢失手动选择的选项分支
    placeholderData: keepPreviousData,
  });
}

const OPS = ['=', '≥', '≤', '>', '<', '≠'];

/** 条件分支的条件说明（RPG Maker 条件类型 → 文字） */
function conditionText(type: number, args: (string | number | boolean)[], t: TFn): string {
  const onOff = (v: unknown) => t(Number(v) === 0 ? 'branch.on' : 'branch.off');
  switch (type) {
    case 0:
      return t('branch.cond.switch', { id: String(args[0]), value: onOff(args[1]) });
    case 1: {
      const value = Number(args[1]) === 0 ? String(args[2]) : t('branch.cond.varRef', { id: String(args[2]) });
      return t('branch.cond.variable', { id: String(args[0]), op: OPS[Number(args[3])] ?? '?', value });
    }
    case 2:
      return t('branch.cond.selfSwitch', { ch: String(args[0]), value: onOff(args[1]) });
    case 4:
      return t('branch.cond.actor', { id: String(args[0]) });
    case 7:
      return t('branch.cond.gold', { op: ['≥', '≤', '<'][Number(args[1])] ?? '?', value: String(args[0]) });
    case 8:
      return t('branch.cond.item', { id: String(args[0]) });
    case 9:
      return t('branch.cond.weapon', { id: String(args[0]) });
    case 10:
      return t('branch.cond.armor', { id: String(args[0]) });
    case 12:
      return t('branch.cond.script', { code: String(args[0]) });
    default:
      return t('branch.cond.other', { type });
  }
}

export function branchText(s: BranchStep, t: TFn): string {
  switch (s.k) {
    case 'choice':
      return t('branch.choice', { i: s.i, text: s.text });
    case 'cancel':
      return t('branch.cancel');
    case 'if':
      return t('branch.if', { cond: conditionText(s.type, s.args, t) });
    case 'else':
      return t('branch.else', { cond: conditionText(s.type, s.args, t) });
    case 'battle':
      return t(`branch.battle.${s.result}`);
    case 'loop':
      return t('branch.loop');
  }
}

/** 一条词条行：点击跳转（当前词条不可点） */
function SceneRow({ it, depth, onJump }: { it: SceneItem; depth: number; onJump: (id: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (it.current) ref.current?.scrollIntoView({ block: 'center' });
  }, [it.current]);
  return (
    <button
      type="button"
      ref={ref}
      className={`scene-row${it.current ? ' current' : ''}${it.stage === 'HIDDEN' ? ' hidden' : ''}`}
      style={{ marginLeft: depth * 16, width: `calc(100% - ${depth * 16}px)` }}
      onClick={() => !it.current && onJump(it.id)}
    >
      <StageDot stage={it.stage} />
      <div className="ctx-text">
        <div className="scene-meta">
          <span className="muted small">{t(`category.${it.category}`)}</span>
          {it.speaker && (
            <Tooltip title={it.speaker.face ? t('scene.face', { face: it.speaker.face }) : undefined}>
              <Tag bordered={false} icon={<UserOutlined />} className="scene-speaker">
                {it.speaker.name ?? it.speaker.face}
              </Tag>
            </Tooltip>
          )}
        </div>
        <div className="pre-wrap">
          <CodesOnly text={it.original} />
        </div>
        {it.translation && (
          <div className="pre-wrap muted">
            <CodesOnly text={it.translation} />
          </div>
        )}
      </div>
    </button>
  );
}

/** 一组选项：点选项文字跳转翻译，点右侧按钮切换下方显示的分支 */
function ChoiceBlock({ group, selected, onPick, onJump }: { group: ChoiceGroup<SceneItem>; selected: number; onPick: (i: number) => void; onJump: (id: string) => void }) {
  const t = useT();
  return (
    <div className="scene-choices" style={{ marginLeft: group.depth * 16 }}>
      <div className="scene-choices-hint">{t('scene.choicesHint', { count: group.options.length })}</div>
      <div role="radiogroup" aria-label={t('scene.choicesLabel')}>
        {group.options.map(({ i, entry }) => {
          const on = i === selected;
          return (
            <div key={entry.id} className={`scene-choice${entry.current ? ' current' : ''}`}>
              <button type="button" className="scene-choice-text" onClick={() => !entry.current && onJump(entry.id)}>
                <StageDot stage={entry.stage} />
                <span className="muted small">{t('scene.option', { i })}</span>
                <span className="ctx-text">
                  <span className="pre-wrap">
                    <CodesOnly text={entry.original} />
                  </span>
                  {entry.translation && (
                    <span className="pre-wrap muted scene-choice-dst">
                      <CodesOnly text={entry.translation} />
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={t('scene.viewBranchOf', { i })}
                className={`scene-branch-toggle${on ? ' on' : ''}`}
                onClick={() => onPick(i)}
              >
                <BranchesOutlined /> {t(on ? 'scene.viewing' : 'scene.viewBranch')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 整段事件：按分支缩进显示；同一组选项只显示所选选项之后的对话，
 * 当前词条所在的选项分支自动选中。docked 时占满右栏高度。
 */
export function SceneView({ data, onJump, docked }: { data: SceneData; onJump: (id: string) => void; docked?: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<Record<string, number>>({});
  const curId = data.items.find((i) => i.current)?.id;
  // 不同文件可能有相同的键前缀（如各地图的 events/1/pages/0/list/），连同文件一起比较
  const prefix = data.scene ? `${data.scene.fileId}:${data.scene.prefix}` : undefined;
  const lastPrefix = useRef(prefix);
  // 切换到当前词条所在的选项分支；同一段事件内手动选择的其他分组保留，换到另一段事件时重置
  useEffect(() => {
    const same = lastPrefix.current === prefix;
    lastPrefix.current = prefix;
    setSelected((s) => ({ ...(same ? s : {}), ...(curId ? selectionFor(data.items, curId) : {}) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curId, prefix]);
  const nodes = useMemo(() => buildScene(data.items, selected), [data.items, selected]);

  return (
    <div className={`scene${docked ? ' docked' : ''}`}>
      {!docked && (
        <div className="scene-title">
          <Typography.Text strong>{data.scene!.title}</Typography.Text>
          <span className="muted small">{t('scene.count', { count: data.items.length })}</span>
        </div>
      )}
      <div className="scene-list">
        {nodes.map((n, idx) => {
          if (n.type === 'row') return <SceneRow key={n.entry.id} it={n.entry} depth={n.depth} onJump={onJump} />;
          if (n.type === 'head')
            return (
              <div key={`h-${idx}`} className="scene-branch" style={{ marginLeft: n.depth * 16 }}>
                <ApartmentOutlined /> {branchText(n.step, t)}
              </div>
            );
          if (n.type === 'choices')
            return <ChoiceBlock key={`c-${n.group.id}`} group={n.group} selected={n.selected} onPick={(i) => setSelected((s) => ({ ...s, [n.group.id]: i }))} onJump={onJump} />;
          return (
            <div key={`p-${n.group.id}`} className="scene-picked" style={{ marginLeft: n.depth * 16 }}>
              <span className="scene-picked-pill">{t('scene.afterChoice', { text: n.text })}</span>
              {n.hidden > 0 && <span className="muted small">{t('scene.hiddenOther', { count: n.hidden })}</span>}
            </div>
          );
        })}
      </div>
      {data.scene!.truncated && <div className="muted small">{t('scene.truncated')}</div>}
      {!data.items.some((i) => i.branch) && <div className="muted small scene-hint">{t('scene.noBranchHint')}</div>}
    </div>
  );
}
