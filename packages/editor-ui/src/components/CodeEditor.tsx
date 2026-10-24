import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ThemeFileKind } from "../api/types.js";

interface Props {
  value: string;
  kind: ThemeFileKind;
  onChange: (value: string) => void;
}

function languageExt(kind: ThemeFileKind): Extension[] {
  switch (kind) {
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "js":
    case "json":
      return [javascript()];
    default:
      return [];
  }
}

/**
 * Thin React wrapper over CodeMirror 6, used by the theme/part code editor.
 * The editor instance is recreated when the language (file kind) changes, and
 * external value changes (switching files) reset the document without firing a
 * spurious onChange.
 */
export function CodeEditor({ value, kind, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const external = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        ...languageExt(kind),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !external.current) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // Recreate on kind change; value is read at creation time (the separate
    // effect below syncs later external value changes).
  }, [kind]);

  // Reset the document when the file (value) changes from outside.
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    external.current = true;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    external.current = false;
  }, [value]);

  return <div className="pcms-code" ref={host} />;
}
