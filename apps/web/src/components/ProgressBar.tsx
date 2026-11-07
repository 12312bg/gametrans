import { Tooltip } from 'antd';
import { STAGE_LABELS } from '@gametrans/shared';
import type { StageCounts } from '../api/types';
import { progressOf } from '../utils';
import { STAGE_DOT } from './Tags';

/** 分段进度条：已审核/已锁定（绿/紫）、已翻译（蓝）、有疑问（橙）、未翻译（灰） */
export function ProgressBar({ stats, height = 8, showText = true }: { stats: StageCounts | undefined; height?: number; showText?: boolean }) {
  const p = progressOf(stats);
  const seg = (n: number) => (p.total ? `${(n / p.total) * 100}%` : '0%');
  const parts = [
    { k: 'LOCKED' as const, n: p.s.LOCKED },
    { k: 'REVIEWED' as const, n: p.s.REVIEWED },
    { k: 'TRANSLATED' as const, n: p.s.TRANSLATED },
    { k: 'QUESTIONED' as const, n: p.s.QUESTIONED },
  ];
  const tip = (
    <div style={{ lineHeight: 1.8 }}>
      {(['REVIEWED', 'LOCKED', 'TRANSLATED', 'QUESTIONED', 'UNTRANSLATED', 'HIDDEN'] as const).map((k) => (
        <div key={k}>
          <span className="stage-dot" style={{ background: STAGE_DOT[k], marginRight: 6 }} />
          {STAGE_LABELS[k]}：{p.s[k].toLocaleString()}
        </div>
      ))}
    </div>
  );
  return (
    <Tooltip title={tip}>
      <div className="progress-wrap">
        <div className="progress-track" style={{ height }}>
          {parts.map((x) => (x.n ? <div key={x.k} style={{ width: seg(x.n), background: STAGE_DOT[x.k] }} /> : null))}
        </div>
        {showText && (
          <div className="progress-text">
            <span>
              已翻译 <b>{p.translatedPct}%</b>
            </span>
            <span>
              已审核 <b>{p.reviewedPct}%</b>
            </span>
            <span className="muted">{p.total.toLocaleString()} 条</span>
          </div>
        )}
      </div>
    </Tooltip>
  );
}
