import { t } from "../i18n.js";

interface AddSectionModalProps {
  catalog: { type: string; label: string }[];
  onPick: (type: string) => void;
  onClose: () => void;
}

/** Pick a section type to insert at a chosen position. */
export function AddSectionModal({ catalog, onPick, onClose }: AddSectionModalProps) {
  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("sections.add")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--narrow">
        <header className="pcms-modal__head">
          <h2>{t("sections.add")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>
        <div className="pcms-sectionpalette">
          {catalog.map((c) => (
            <button key={c.type} type="button" onClick={() => onPick(c.type)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
