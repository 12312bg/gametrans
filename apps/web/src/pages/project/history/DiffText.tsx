import { presentableDiff } from '@codemirror/merge';
import { Fragment, useMemo } from 'react';

/** 单栏对比：删除的文字划线标红，新增的文字标绿 */
export function DiffText({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => {
    const out: { text: string; type: 'same' | 'del' | 'ins' }[] = [];
    let a = 0;
    for (const c of presentableDiff(before, after)) {
      if (c.fromA > a) out.push({ text: before.slice(a, c.fromA), type: 'same' });
      if (c.toA > c.fromA) out.push({ text: before.slice(c.fromA, c.toA), type: 'del' });
      if (c.toB > c.fromB) out.push({ text: after.slice(c.fromB, c.toB), type: 'ins' });
      a = c.toA;
    }
    if (a < before.length) out.push({ text: before.slice(a), type: 'same' });
    return out;
  }, [before, after]);
  return (
    <div className="diff-text pre-wrap">
      {parts.map((p, i) =>
        p.type === 'same' ? (
          <Fragment key={i}>{p.text}</Fragment>
        ) : p.type === 'del' ? (
          <del key={i}>{p.text}</del>
        ) : (
          <ins key={i}>{p.text}</ins>
        ),
      )}
    </div>
  );
}
