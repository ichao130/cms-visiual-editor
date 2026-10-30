import { useEffect, useState } from "react";
import type { MediaItem } from "@pcms/shared";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

/** Editable default alt text for one media item; commits on blur. */
function AltField({ item, onCommit }: { item: MediaItem; onCommit: (alt: string) => void }) {
  const [alt, setAlt] = useState(item.alt ?? "");
  // Keep in sync when the underlying record changes (e.g. after a save round-trip).
  useEffect(() => setAlt(item.alt ?? ""), [item.alt]);
  const commit = () => {
    const trimmed = alt.trim();
    if (trimmed !== (item.alt ?? "")) onCommit(trimmed);
  };
  return (
    <input
      type="text"
      className="pcms-media__alt"
      value={alt}
      onChange={(e) => setAlt(e.target.value)}
      onBlur={commit}
      placeholder={t("media.altPlaceholder")}
      aria-label={t("media.alt").replace("{name}", item.fileName)}
    />
  );
}

interface MediaLibraryProps {
  media: MediaItem[];
  importing: boolean;
  /** When set, a "選択" action is shown on each item (picker mode). */
  onSelect?: (item: MediaItem) => void;
  /** When set, a delete action is shown on each item (browse mode). */
  onDelete?: (item: MediaItem) => void;
  /** When set, each item gets an editable default alt-text field (browse mode). */
  onAltChange?: (item: MediaItem, alt: string) => void;
  /** Reference count per media path, for the "used N times" badge (browse mode). */
  usage?: Record<string, number>;
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
  onAltChange,
  usage,
  onImport,
  onClose,
}: MediaLibraryProps) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? media.filter((m) => m.fileName.toLowerCase().includes(q)) : media;
  const confirmDelete = (item: MediaItem) => {
    const used = usage?.[item.path] ?? 0;
    const msg =
      used > 0
        ? t("media.deleteUsedConfirm")
            .replace("{name}", item.fileName)
            .replace("{count}", String(used))
        : t("media.deleteConfirm").replace("{name}", item.fileName);
    if (window.confirm(msg)) {
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
                    {usage && (
                      <span
                        className={`pcms-media__usage${(usage[item.path] ?? 0) === 0 ? " is-unused" : ""}`}
                      >
                        {(usage[item.path] ?? 0) === 0
                          ? t("media.unused")
                          : t("media.usedCount").replace("{count}", String(usage[item.path]))}
                      </span>
                    )}
                    {onAltChange && (
                      <AltField item={item} onCommit={(alt) => onAltChange(item, alt)} />
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
