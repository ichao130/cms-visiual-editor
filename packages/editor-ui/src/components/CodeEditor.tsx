import { useEffect, useRef, useState } from "react";
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

/** Track the OS/app colour scheme so the editor theme can match the UI. */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
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
  const dark = usePrefersDark();
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        // one-dark in dark mode; CodeMirror's light default in light mode, so
        // the editor matches the surrounding UI instead of always being dark.
        ...(dark ? [oneDark] : []),
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
    // Recreate on kind/theme change; value is read at creation time (the
    // separate effect below syncs later external value changes).
  }, [kind, dark]);

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
