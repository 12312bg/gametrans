import { MergeView, getChunks, unifiedMergeView } from '@codemirror/merge';
import { EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { CodeLanguage, baseExtensions } from './setup';

export type DiffMode = 'split' | 'unified';

interface Props {
  original: string;
  modified: string;
  mode: DiffMode;
  language: CodeLanguage;
  height?: number | string;
  /** 改动统计：增加 / 删除的行数与改动块数 */
  onStats?: (s: { added: number; removed: number; chunks: number }) => void;
}

const collapse = { margin: 3, minSize: 4 };

function countLines(doc: Text, from: number, to: number) {
  if (to <= from) return 0;
  return doc.lineAt(Math.max(from, to - 1)).number - doc.lineAt(from).number + 1;
}

/** 类似 GitHub 的差异对比：并排或行内显示，未改动的部分折叠（按需加载） */
export default function DiffView({ original, modified, mode, language, height = 520, onStats }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stats = useRef(onStats);
  stats.current = onStats;

  useEffect(() => {
    const ext = baseExtensions(language, true);
    let destroy: () => void;
    if (mode === 'split') {
      const mv = new MergeView({
        parent: host.current!,
        a: { doc: original, extensions: ext },
        b: { doc: modified, extensions: ext },
        collapseUnchanged: collapse,
        highlightChanges: true,
        gutter: true,
      });
      const a = mv.a.state.doc;
      const b = mv.b.state.doc;
      stats.current?.({
        chunks: mv.chunks.length,
        removed: mv.chunks.reduce((n, c) => n + countLines(a, c.fromA, c.toA), 0),
        added: mv.chunks.reduce((n, c) => n + countLines(b, c.fromB, c.toB), 0),
      });
      destroy = () => mv.destroy();
    } else {
      const view = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc: modified,
          extensions: [ext, unifiedMergeView({ original, highlightChanges: true, gutter: true, mergeControls: false, collapseUnchanged: collapse })],
        }),
      });
      const info = getChunks(view.state);
      const a = Text.of(original.split('\n'));
      stats.current?.({
        chunks: info?.chunks.length ?? 0,
        removed: info?.chunks.reduce((n, c) => n + countLines(a, c.fromA, c.toA), 0) ?? 0,
        added: info?.chunks.reduce((n, c) => n + countLines(view.state.doc, c.fromB, c.toB), 0) ?? 0,
      });
      destroy = () => view.destroy();
    }
    return () => destroy();
  }, [original, modified, mode, language]);

  return <div className={`diff-view diff-${mode}`} ref={host} style={{ height }} />;
}
