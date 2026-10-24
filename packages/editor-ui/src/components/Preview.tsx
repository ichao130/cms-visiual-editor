import { t } from "../i18n.js";

interface PreviewProps {
  html: string;
}

/**
 * Live preview. The generated site/theme HTML is untrusted content, so it is
 * rendered in a sandboxed iframe with no script execution and no same-origin
 * access (CLAUDE.md: プレビューは信頼しないコンテンツとして別領域で描画).
 */
export function Preview({ html }: PreviewProps) {
  return (
    <section className="pcms-preview" aria-label={t("preview.title")}>
      <iframe
        className="pcms-preview__frame"
        title={t("preview.title")}
        sandbox=""
        srcDoc={html}
      />
    </section>
  );
}
