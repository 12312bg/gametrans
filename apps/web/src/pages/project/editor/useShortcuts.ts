import { useEffect, useRef } from 'react';
import type { Entry } from '../../../api/types';

export const SHORTCUTS: [string, string][] = [
  ['Ctrl + Enter', 'shortcut.saveNext'],
  ['Ctrl + S', 'shortcut.save'],
  ['Ctrl + Shift + Enter', 'shortcut.reviewNext'],
  ['Alt + ↓ / Alt + ↑', 'shortcut.move'],
  ['Alt + C', 'shortcut.copySource'],
  ['Alt + 1~5', 'shortcut.useTm'],
];

interface Actions {
  current: Entry | undefined;
  editable: boolean;
  canReview: boolean;
  draftOf: (e: Entry) => string;
  setDraft: (id: string, v: string) => void;
  save: (opts?: { stage?: 'REVIEWED'; next?: boolean }) => void;
  move: (dir: 1 | -1) => void;
  /** 第 n 条（从 0 开始）翻译记忆的译文 */
  suggestion: (e: Entry, n: number) => string | undefined;
}

/** 编辑器快捷键；每次渲染更新处理函数，监听只注册一次 */
export function useShortcuts(actions: Actions) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { current, editable, canReview, draftOf, setDraft, save, move, suggestion } = ref.current;
      if (!current) return;
      const mod = e.ctrlKey || e.metaKey;
      const handled = () => e.preventDefault();
      if (mod && e.key === 'Enter' && e.shiftKey) {
        handled();
        if (canReview && draftOf(current).trim()) save({ stage: 'REVIEWED', next: true });
      } else if (mod && e.key === 'Enter') {
        handled();
        if (editable) save({ next: true });
        else move(1);
      } else if (mod && e.key.toLowerCase() === 's') {
        handled();
        if (editable) save();
      } else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        handled();
        move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.altKey && editable && (e.code === 'KeyC' || e.key === 'c')) {
        handled();
        setDraft(current.id, current.original);
      } else if (e.altKey && editable && /^Digit[1-5]$/.test(e.code)) {
        const s = suggestion(current, Number(e.code.slice(5)) - 1);
        if (s !== undefined) {
          handled();
          setDraft(current.id, s);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
