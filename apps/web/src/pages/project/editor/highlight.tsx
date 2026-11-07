import { Tooltip } from 'antd';
import { CONTROL_CODE_REGEX } from '@gametrans/shared';
import { ReactNode } from 'react';
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
  const ranges: Range[] = [];
  for (const m of text.matchAll(new RegExp(CONTROL_CODE_REGEX.source, 'g'))) {
    ranges.push({ start: m.index!, end: m.index! + m[0].length });
  }
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

/** 渲染带控制符与术语高亮的文本 */
export function Highlighted({ text, terms }: { text: string; terms: Term[] }) {
  const { ranges } = findTerms(text, terms);
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
            </span>
          }
        >
          <span className="hl-term">{seg}</span>
        </Tooltip>,
      );
    } else {
      out.push(
        <span key={i} className="hl-code">
          {seg}
        </span>,
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
  for (const m of text.matchAll(new RegExp(CONTROL_CODE_REGEX.source, 'g'))) {
    if (m.index! > pos) out.push(text.slice(pos, m.index));
    out.push(
      <span key={i++} className="hl-code">
        {m[0]}
      </span>,
    );
    pos = m.index! + m[0].length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}
