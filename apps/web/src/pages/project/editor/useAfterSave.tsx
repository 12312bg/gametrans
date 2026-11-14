import { UndoOutlined } from '@ant-design/icons';
import { App, Button, Checkbox, Space } from 'antd';
import type { Stage } from '@gametrans/shared';
import { useRef, useState } from 'react';
import { api } from '../../../api/client';
import type { Entry } from '../../../api/types';
import { StageTag } from '../../../components/Tags';
import { useT } from '../../../i18n';
import { errorMessage } from '../../../utils';

/** 保存接口带 ?identical=1 时附带的计数 */
export interface IdenticalCounts {
  fill: number;
  sameText: number;
  differ: number;
  skipped: number;
}

interface Choice {
  apply: boolean;
  overwrite: boolean;
}

interface UndoItem {
  id: string;
  /** 修改后的版本 */
  version: number;
  /** 修改前的译文与状态 */
  translation: string;
  stage: Stage;
}

const UNDO_KEY = 'gt-undo';

function PropagateBody({ counts, stage, choice, onRemember }: { counts: IdenticalCounts; stage: Stage; choice: Choice; onRemember: (v: boolean) => void }) {
  const t = useT();
  const [overwrite, setOverwrite] = useState(choice.overwrite);
  const [remember, setRemember] = useState(false);
  return (
    <div className="propagate-body">
      <p>
        {t('identical.desc')} <StageTag stage={stage} />
      </p>
      <ul>
        {counts.fill > 0 && <li>{t('identical.fill', { count: counts.fill })}</li>}
        {counts.sameText > 0 && <li>{t('identical.sameText', { count: counts.sameText })}</li>}
        {counts.skipped > 0 && <li className="muted">{t('identical.skipped', { count: counts.skipped })}</li>}
      </ul>
      {counts.differ > 0 && (
        <Checkbox
          checked={overwrite}
          onChange={(e) => {
            setOverwrite(e.target.checked);
            choice.overwrite = e.target.checked;
          }}
        >
          {t('identical.overwrite', { count: counts.differ })}
        </Checkbox>
      )}
      <div>
        <Checkbox
          checked={remember}
          onChange={(e) => {
            setRemember(e.target.checked);
            onRemember(e.target.checked);
          }}
        >
          {t('identical.remember')}
        </Checkbox>
      </div>
    </div>
  );
}

/**
 * 保存之后：
 * 1. 有原文完全相同的其他词条时询问是否一并应用（可记住本次选择，刷新页面后重新询问）；
 * 2. 显示「撤销」，把本次修改（含一并应用的词条）恢复到修改前。
 */
export function useAfterSave(pid: string, onChanged: () => void) {
  const t = useT();
  const { modal, message } = App.useApp();
  const remembered = useRef<Choice | null>(null);

  const ask = (counts: IdenticalCounts, stage: Stage) =>
    new Promise<Choice>((resolve) => {
      // 只有「已有不同译文」时，确认即表示覆盖
      const onlyDiffer = counts.fill + counts.sameText === 0;
      const choice: Choice = { apply: false, overwrite: onlyDiffer };
      let remember = false;
      const done = (apply: boolean) => {
        choice.apply = apply;
        if (remember) remembered.current = { ...choice };
        resolve(choice);
      };
      const total = counts.fill + counts.sameText + counts.differ;
      modal.confirm({
        title: t(onlyDiffer ? 'identical.titleDiffer' : 'identical.title', { count: onlyDiffer ? counts.differ : total }),
        width: 520,
        content: <PropagateBody counts={counts} stage={stage} choice={choice} onRemember={(v) => (remember = v)} />,
        okText: t('identical.apply'),
        cancelText: t('identical.onlyThis'),
        autoFocusButton: 'ok',
        onOk: () => done(true),
        onCancel: () => done(false),
      });
    });

  const undo = async (items: UndoItem[]) => {
    message.destroy(UNDO_KEY);
    try {
      const res = await api<{ saved: number; conflict: number; error: number; rejected: number }>(`/projects/${pid}/entries/bulk-save`, {
        method: 'POST',
        body: { items: items.map((i) => ({ ...i, note: t('identical.undoNote') })) },
      });
      const failed = res.conflict + res.error + res.rejected;
      if (failed) message.warning(t('identical.undoPartial', { count: res.saved, failed }));
      else message.success(t('identical.undone', { count: res.saved }));
    } catch (e) {
      message.error(errorMessage(e));
    }
    onChanged();
  };

  const offerUndo = (items: UndoItem[], extra: number) => {
    message.open({
      key: UNDO_KEY,
      type: 'success',
      duration: 8,
      content: (
        <Space size={8}>
          <span>{extra ? t('identical.savedWith', { count: extra }) : t('identical.saved')}</span>
          <Button size="small" type="link" icon={<UndoOutlined />} onClick={() => void undo(items)}>
            {t('identical.undo')}
          </Button>
        </Space>
      ),
    });
  };

  /** before：保存前的词条；saved：保存接口的返回 */
  return async (before: Entry, saved: Entry & { identical?: IdenticalCounts }) => {
    const items: UndoItem[] = [{ id: saved.id, version: saved.version, translation: before.translation, stage: before.stage }];
    const c = saved.identical;
    let extra = 0;
    if (c && c.fill + c.sameText + c.differ > 0) {
      const choice = remembered.current ?? (await ask(c, saved.stage));
      if (choice.apply && (choice.overwrite || c.fill + c.sameText > 0)) {
        try {
          const res = await api<{ affected: number; skipped: number; previous: UndoItem[] }>(`/projects/${pid}/entries/${saved.id}/propagate`, {
            method: 'POST',
            body: { overwrite: choice.overwrite },
          });
          items.push(...res.previous);
          extra = res.affected;
          onChanged();
        } catch (e) {
          message.error(errorMessage(e));
        }
      }
    }
    offerUndo(items, extra);
  };
}
