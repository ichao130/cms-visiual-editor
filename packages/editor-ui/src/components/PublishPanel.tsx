import type { PcmsApi } from "../api/types.js";
import { PublishFlow } from "./PublishFlow.js";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

interface PublishPanelProps {
  api: PcmsApi;
  onClose: () => void;
}

/** Modal wrapper around the publish flow, used from the theme editor toolbar. */
export function PublishPanel({ api, onClose }: PublishPanelProps) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("publish.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--wide" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("publish.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>
        <PublishFlow api={api} />
      </div>
    </div>
  );
}
