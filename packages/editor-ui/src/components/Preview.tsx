import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../i18n.js";

interface PreviewProps {
  html: string;
  /** The currently selected section id, mirrored into the preview. */
  selectedSection?: string | null;
  /** Preview device width. */
  device?: "desktop" | "mobile";
  /** Overlay rendered on top of the iframe (e.g. the inline editor). */
  overlay?: ReactNode;
}

/**
 * Live preview. The site/theme HTML is untrusted, so it renders in a sandboxed
 * iframe with no same-origin access; theme scripts are stripped upstream and
 * only our editor runtime runs (sandbox="allow-scripts"). It talks to the
 * editor via postMessage (CLAUDE.md: プレビューは信頼しないコンテンツ).
 */
export function Preview({ html, selectedSection, device = "desktop", overlay }: PreviewProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  const syncSelection = () => {
    ref.current?.contentWindow?.postMessage(
      { source: "pcms-editor", type: "select", section: selectedSection ?? null },
      "*",
    );
  };

  // Re-sync when the selection changes without a full re-render.
  useEffect(syncSelection, [selectedSection]);

  // Drive the sandboxed iframe via srcdoc, set imperatively. Inside the shell's
  // nested flex layout, setting srcdoc in the same commit can paint blank, so we
  // blank it now and write the content on the next frame (after layout settles):
  // two distinct values across frames guarantee a real load at the final size.
  // The iframe stays sandboxed (allow-scripts), so it remains untrusted content
  // and talks to the editor only via postMessage.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      // Remove + reflow + set in one task forces a clean reload into the content
      // (splitting remove and set across tasks lets the blank load settle first,
      // and the later set then fails to repaint).
      el.removeAttribute("srcdoc");
      void el.offsetHeight;
      el.setAttribute("srcdoc", html);
    }, 60);
    return () => window.clearTimeout(id);
  }, [html]);

  return (
    <section className={`pcms-preview pcms-preview--${device}`} aria-label={t("preview.title")}>
      <div className="pcms-preview__stage">
        <iframe
          ref={ref}
          className="pcms-preview__frame"
          title={t("preview.title")}
          sandbox="allow-scripts"
          onLoad={syncSelection}
        />
        {overlay}
      </div>
    </section>
  );
}
