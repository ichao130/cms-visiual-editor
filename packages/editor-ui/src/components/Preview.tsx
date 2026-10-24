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

  return (
    <section className={`pcms-preview pcms-preview--${device}`} aria-label={t("preview.title")}>
      <div className="pcms-preview__stage">
        <iframe
          ref={ref}
          className="pcms-preview__frame"
          title={t("preview.title")}
          sandbox="allow-scripts"
          srcDoc={html}
          onLoad={syncSelection}
        />
        {overlay}
      </div>
    </section>
  );
}
