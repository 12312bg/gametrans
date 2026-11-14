import { ApartmentOutlined, UserOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Tag, Tooltip, Typography } from 'antd';
import type { BranchStep, Stage } from '@gametrans/shared';
import { Fragment, useEffect, useRef } from 'react';
import { api } from '../../../api/client';
import { StageDot } from '../../../components/Tags';
import { TFn, useT } from '../../../i18n';
import { CodesOnly } from './highlight';

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

export function useScene(pid: string, entryId: string) {
  return useQuery({
    queryKey: ['scene', entryId],
    queryFn: () => api<SceneData>(`/projects/${pid}/entries/${entryId}/scene`),
    staleTime: 30_000,
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

const same = (a: BranchStep[] | null, b: BranchStep[] | null) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** 整段事件：按分支缩进显示，分支变化处插入分支标题 */
export function SceneView({ data, onJump }: { data: SceneData; onJump: (id: string) => void }) {
  const t = useT();
  const currentRef = useRef<HTMLDivElement>(null);
  const curId = data.items.find((i) => i.current)?.id;
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, [curId]);

  let prev: BranchStep[] | null = null;
  return (
    <div className="scene">
      <div className="scene-title">
        <Typography.Text strong>{data.scene!.title}</Typography.Text>
        <span className="muted small">{t('scene.count', { count: data.items.length })}</span>
      </div>
      <div className="scene-list">
        {data.items.map((it) => {
          const path = it.branch ?? [];
          // 与上一条相比，从第一个不同的层级开始显示分支标题
          let common = 0;
          const before = prev ?? [];
          while (common < path.length && common < before.length && JSON.stringify(path[common]) === JSON.stringify(before[common])) common++;
          const heads = same(prev, it.branch) ? [] : path.slice(common).map((s, d) => ({ s, depth: common + d }));
          prev = it.branch;
          return (
            <Fragment key={it.id}>
              {heads.map(({ s, depth }) => (
                <div key={`${it.id}-h${depth}`} className="scene-branch" style={{ marginLeft: depth * 16 }}>
                  <ApartmentOutlined /> {branchText(s, t)}
                </div>
              ))}
              <div
                ref={it.current ? currentRef : undefined}
                className={`scene-row${it.current ? ' current' : ''}${it.stage === 'HIDDEN' ? ' hidden' : ''}`}
                style={{ marginLeft: path.length * 16 }}
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
              </div>
            </Fragment>
          );
        })}
      </div>
      {data.scene!.truncated && <div className="muted small">{t('scene.truncated')}</div>}
      {!data.items.some((i) => i.branch) && <div className="muted small scene-hint">{t('scene.noBranchHint')}</div>}
    </div>
  );
}
