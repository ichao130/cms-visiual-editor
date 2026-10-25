import { useEffect, useRef } from "react";

interface Props {
  /** The part's HTML (the code being edited). */
  html: string;
  /** Theme CSS so the part shows with its real styling. */
  css: string;
}

/**
 * Live, styled preview of a single theme part (section) as it is edited. The
 * HTML is theme source, rendered statically in a fully sandboxed iframe (no
 * scripts), debounced so typing stays smooth. Media with relative paths won't
 * load here — it's a structural/styling preview.
 */
export function PartPreview({ html, css }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const doc =
      `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
      `<style>${css}</style><style>body{margin:0;padding:16px;}</style>` +
      `</head><body>${html}</body></html>`;
    // Defer + remove/reflow/set so the iframe reliably paints in the nested
    // flex layout (same quirk as the main preview).
    const id = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.removeAttribute("srcdoc");
      void el.offsetHeight;
      el.setAttribute("srcdoc", doc);
    }, 250);
    return () => window.clearTimeout(id);
  }, [html, css]);

  return <iframe ref={ref} className="pcms-partpreview__frame" sandbox="" title="preview" />;
}
