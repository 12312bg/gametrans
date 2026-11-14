import { Tooltip } from 'antd';
import { controlCodeSpans } from '@gametrans/shared';
import { MouseEvent, ReactNode } from 'react';
import type { Term } from '../../../api/types';

interface Range {
  start: number;
  end: number;
  term?: Term;
}

function overlaps(ranges: Range[], s: number, e: number) {
  return ranges.some((r) => s < r.end && e > r.start);
}

/** 找出原文中命中的术语（长术语优先，避免被短术语切碎） */
export function findTerms(text: string, terms: Term[]): { ranges: Range[]; matched: Term[] } {
  // 名字框 \n<名字> 中的名字不算控制符，可以命中术语
  const ranges: Range[] = controlCodeSpans(text);
  const matched: Term[] = [];
  const lower = text.toLowerCase();
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  for (const t of sorted) {
    if (!t.term) continue;
    const hay = t.caseSensitive ? text : lower;
    const needle = t.caseSensitive ? t.term : t.term.toLowerCase();
    let from = 0;
    let hit = false;
    while (from <= hay.length) {
      const i = hay.indexOf(needle, from);
      if (i < 0) break;
      const end = i + needle.length;
      if (!overlaps(ranges, i, end)) {
        ranges.push({ start: i, end, term: t });
        hit = true;
      }
      from = i + Math.max(1, needle.length);
    }
    if (hit) matched.push(t);
  }
  ranges.sort((a, b) => a.start - b.start);
  return { ranges, matched };
}

/** 选中文字（复制原文）时不触发插入 */
const hasSelection = () => !!window.getSelection()?.toString();

/**
 * 渲染带控制符与术语高亮的文本。
 * 传入 onInsert 时，点击控制符插入该控制符，点击术语插入约定译法。
 */
export function Highlighted({ text, terms, onInsert, insertHint }: { text: string; terms: Term[]; onInsert?: (s: string) => void; insertHint?: string }) {
  const { ranges } = findTerms(text, terms);
  const click = (s: string) =>
    onInsert
      ? {
          role: 'button',
          onMouseDown: (e: MouseEvent) => e.preventDefault(), // 保持译文框的焦点与光标
          onClick: () => !hasSelection() && onInsert(s),
        }
      : {};
  const cls = (base: string) => (onInsert ? `${base} insertable` : base);
  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (r.start > pos) out.push(text.slice(pos, r.start));
    const seg = text.slice(r.start, r.end);
    if (r.term) {
      out.push(
        <Tooltip
          key={i}
          title={
            <span>
              <b>{r.term.translation}</b>
              {r.term.note ? <span style={{ opacity: 0.8 }}> — {r.term.note}</span> : null}
              {onInsert && insertHint ? <div style={{ opacity: 0.7, fontSize: 12 }}>{insertHint}</div> : null}
            </span>
          }
        >
          <span className={cls('hl-term')} {...click(r.term.translation)}>
            {seg}
          </span>
        </Tooltip>,
      );
    } else {
      const code = (
        <span key={i} className={cls('hl-code')} {...click(seg)}>
          {seg}
        </span>
      );
      out.push(
        onInsert && insertHint ? (
          <Tooltip key={i} title={insertHint} mouseEnterDelay={0.6}>
            {code}
          </Tooltip>
        ) : (
          code
        ),
      );
    }
    pos = r.end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}

/** 只高亮控制符（列表中使用，性能更好） */
export function CodesOnly({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let pos = 0;
  let i = 0;
  for (const r of controlCodeSpans(text)) {
    if (r.start > pos) out.push(text.slice(pos, r.start));
    out.push(
      <span key={i++} className="hl-code">
        {text.slice(r.start, r.end)}
      </span>,
    );
    pos = r.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}
