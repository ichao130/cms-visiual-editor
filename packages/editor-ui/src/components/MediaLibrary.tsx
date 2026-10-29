import { useState } from "react";
import type { MediaItem } from "@pcms/shared";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

interface MediaLibraryProps {
  media: MediaItem[];
  importing: boolean;
  /** When set, a "選択" action is shown on each item (picker mode). */
  onSelect?: (item: MediaItem) => void;
  /** When set, a delete action is shown on each item (browse mode). */
  onDelete?: (item: MediaItem) => void;
  onImport: () => void;
  onClose: () => void;
}

/** Human-readable byte size: B under 1 KiB, KB under 1 MiB, else MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One-line image metadata: "幅×高さ・サイズ", omitting parts that are unknown. */
export function mediaMeta(item: MediaItem): string {
  const parts: string[] = [];
  if (item.width && item.height) parts.push(`${item.width}×${item.height}`);
  if (item.size != null) parts.push(formatBytes(item.size));
  return parts.join("・");
}

/** Modal media library: browse stored images and import new ones. */
export function MediaLibrary({
  media,
  importing,
  onSelect,
  onDelete,
  onImport,
  onClose,
}: MediaLibraryProps) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? media.filter((m) => m.fileName.toLowerCase().includes(q)) : media;
  const confirmDelete = (item: MediaItem) => {
    if (window.confirm(t("media.deleteConfirm").replace("{name}", item.fileName))) {
      onDelete?.(item);
    }
  };
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
          <>
            <input
              type="search"
              className="pcms-media__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("media.search")}
            />
            {shown.length === 0 ? (
              <p className="pcms-empty pcms-media__empty">{t("media.noMatch")}</p>
            ) : (
              <ul className="pcms-media__grid">
                {shown.map((item) => (
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
                    {onDelete && (
                      <button
                        type="button"
                        className="pcms-media__delete"
                        onClick={() => confirmDelete(item)}
                        aria-label={t("media.delete")}
                        title={t("media.delete")}
                      >
                        ✕
                      </button>
                    )}
                    <span className="pcms-media__name">{item.fileName}</span>
                    {mediaMeta(item) && (
                      <span className="pcms-media__meta">{mediaMeta(item)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
