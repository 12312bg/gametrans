import { Tooltip } from 'antd';
import type { StageCounts } from '../api/types';
import { useT } from '../i18n';
import { progressOf } from '../utils';
import { STAGE_DOT } from './Tags';

const SEGMENTS = ['LOCKED', 'REVIEWED', 'TRANSLATED', 'QUESTIONED'] as const;
const LEGEND = ['REVIEWED', 'LOCKED', 'TRANSLATED', 'QUESTIONED', 'UNTRANSLATED', 'HIDDEN'] as const;

/** 分段进度条：已锁定 / 已审核 / 已翻译 / 有疑问，其余为未翻译 */
export function ProgressBar({ stats, height = 8, showText = true }: { stats: StageCounts | undefined; height?: number; showText?: boolean }) {
  const t = useT();
  const p = progressOf(stats);
  const width = (n: number) => (p.total ? `${(n / p.total) * 100}%` : '0%');
  const tip = (
    <div style={{ lineHeight: 1.8 }}>
      {LEGEND.map((k) => (
        <div key={k}>
          <span className="stage-dot" style={{ background: STAGE_DOT[k], marginRight: 6 }} />
          {t(`stage.${k}`)}: {p.s[k].toLocaleString()}
        </div>
      ))}
    </div>
  );
  return (
    <Tooltip title={tip}>
      <div className="progress-wrap">
        <div className="progress-track" style={{ height }}>
          {SEGMENTS.map((k) => (p.s[k] ? <div key={k} style={{ width: width(p.s[k]), background: STAGE_DOT[k] }} /> : null))}
        </div>
        {showText && (
          <div className="progress-text">
            <span>
              {t('progress.translated')} <b>{p.translatedPct}%</b>
            </span>
            <span>
              {t('progress.reviewed')} <b>{p.reviewedPct}%</b>
            </span>
            <span className="muted">{t('common.count', { count: p.total.toLocaleString() })}</span>
          </div>
        )}
      </div>
    </Tooltip>
  );
}
