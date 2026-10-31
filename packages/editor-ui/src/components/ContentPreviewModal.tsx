import { useEffect, useRef } from "react";
import { t } from "../i18n.js";

interface Props {
  /** A full HTML document (theme CSS + media already inlined). */
  html: string;
  title: string;
  onClose: () => void;
}

/**
 * Modal showing how a content item's published page will look, in a fully
 * sandboxed, script-free iframe (the preview HTML is untrusted content, kept
 * out of the editor's own context — CLAUDE.md).
 */
export function ContentPreviewModal({ html, title, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // Defer + reflow + set so the iframe reliably paints in the nested flex
    // layout (same quirk handled in the main preview).
    const id = window.setTimeout(() => {
      const el = frame.current;
      if (!el) return;
      el.removeAttribute("srcdoc");
      void el.offsetHeight;
      el.setAttribute("srcdoc", html);
    }, 50);
    return () => window.clearTimeout(id);
  }, [html]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("content.preview")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--wide pcms-previewmodal" tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>
            {t("content.preview")}：{title}
          </h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>
        <iframe ref={frame} className="pcms-previewmodal__frame" sandbox="" title={title} />
      </div>
    </div>
  );
}
