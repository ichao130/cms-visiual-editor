import type { MediaItem } from "@pcms/shared";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

interface MediaLibraryProps {
  media: MediaItem[];
  importing: boolean;
  /** When set, a "選択" action is shown on each item (picker mode). */
  onSelect?: (item: MediaItem) => void;
  onImport: () => void;
  onClose: () => void;
}

/** Modal media library: browse stored images and import new ones. */
export function MediaLibrary({
  media,
  importing,
  onSelect,
  onImport,
  onClose,
}: MediaLibraryProps) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("media.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("media.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" className="pcms-primary" onClick={onImport} disabled={importing}>
            {importing ? t("media.importing") : t("media.import")}
          </button>
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>

        {media.length === 0 ? (
          <p className="pcms-empty pcms-media__empty">{t("media.empty")}</p>
        ) : (
          <ul className="pcms-media__grid">
            {media.map((item) => (
              <li key={item.path} className="pcms-media__item">
                <button
                  type="button"
                  className="pcms-media__pick"
                  onClick={() => onSelect?.(item)}
                  disabled={!onSelect}
                  title={item.fileName}
                >
                  <img src={item.dataUrl} alt={item.fileName} />
                </button>
                <span className="pcms-media__name">{item.fileName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
