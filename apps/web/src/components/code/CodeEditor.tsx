import { Annotation, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { CodeLanguage, baseExtensions } from './setup';

/** 外部替换内容（如保存后重新加载）时打上标记，不当作用户编辑 */
const External = Annotation.define<boolean>();

interface Props {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  language: CodeLanguage;
  height?: number | string;
}

/** CodeMirror 编辑器（按需加载） */
export default function CodeEditor({ value, onChange, readOnly = false, language, height = 480 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>();
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          baseExtensions(language, readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) change.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly]);

  // 外部替换内容（如撤销预编辑）时同步到编辑器
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: External.of(true) });
  }, [value]);

  return <div className="code-editor" ref={host} style={{ height }} />;
}
