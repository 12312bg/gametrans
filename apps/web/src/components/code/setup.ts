import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';

export type CodeLanguage = 'json' | 'javascript' | 'text';

export const languageOf = (path: string): CodeLanguage => (/\.json$/i.test(path) ? 'json' : /\.js$/i.test(path) ? 'javascript' : 'text');

/** 跟随站点浅色 / 深色主题 */
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '13px', height: '100%' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK SC", monospace' },
  '.cm-gutters': { backgroundColor: 'var(--surface-2)', color: 'var(--muted)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--brand-soft)' },
  '&.cm-focused': { outline: 'none' },
});

export function baseExtensions(language: CodeLanguage, readOnly: boolean): Extension[] {
  return [
    basicSetup,
    EditorView.lineWrapping,
    theme,
    language === 'json' ? json() : language === 'javascript' ? javascript() : [],
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
  ];
}
