import { useEffect, useRef, useState } from "react";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import {
  javascript,
  javascriptLanguage,
  localCompletionSource,
  scopeCompletionSource,
} from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ThemeFileKind } from "../api/types.js";
import { pcmsHtmlCompletions, pcmsCssCompletions } from "./code-complete.js";

interface Props {
  value: string;
  kind: ThemeFileKind;
  onChange: (value: string) => void;
  /**
   * CSS custom-property names the theme defines (without the leading `--`), used
   * to suggest `var(--…)` while editing CSS. Changing it re-creates the editor.
   */
  cssVars?: readonly string[];
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

/**
 * JS/TS completions closer to an IDE: `localCompletionSource` suggests
 * identifiers declared in the file, `scopeCompletionSource` suggests properties
 * of the global scope (e.g. `document.`, `window.`), so typing offers real
 * member names instead of just keywords.
 */
function jsCompletions(): Extension {
  return javascriptLanguage.data.of({
    autocomplete: [localCompletionSource, scopeCompletionSource(globalThis)],
  });
}

function languageExt(kind: ThemeFileKind, cssVars: readonly string[]): Extension[] {
  switch (kind) {
    case "html":
      // html() enables tag/attribute completion and auto-closing tags.
      return [html(), pcmsHtmlCompletions()];
    case "css":
      return [css(), pcmsCssCompletions(cssVars)];
    case "js":
      return [javascript(), jsCompletions()];
    case "json":
      return [javascript({ jsx: false })];
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
export function CodeEditor({ value, kind, onChange, cssVars }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const external = useRef(false);
  const dark = usePrefersDark();
  onChangeRef.current = onChange;
  // Stable key so the editor only re-creates when the var set actually changes.
  const varsKey = (cssVars ?? []).join(",");

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        // Tab indents / Shift-Tab dedents the selection (basicSetup leaves Tab
        // for focus movement by default); 2-space soft indentation throughout.
        keymap.of([indentWithTab]),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        // one-dark in dark mode; CodeMirror's light default in light mode, so
        // the editor matches the surrounding UI instead of always being dark.
        ...(dark ? [oneDark] : []),
        ...languageExt(kind, cssVars ?? []),
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
    // Recreate on kind/theme/vars change; value is read at creation time (the
    // separate effect below syncs later external value changes).
  }, [kind, dark, varsKey]);

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
