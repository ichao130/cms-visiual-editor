import { useState } from "react";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";
import { Icon } from "./Icon.js";

interface AddSectionModalProps {
  catalog: { type: string; label: string }[];
  onPick: (type: string) => void;
  onClose: () => void;
  /** Optional: create a brand-new part (block) by name instead of picking one. */
  onCreateNew?: (name: string) => void;
  /** Heading for the picker (defaults to the add-section label). */
  heading?: string;
  /** Shown when the catalog is empty (e.g. no parts registered yet). */
  emptyHint?: string;
}

/** Pick a section / block type to insert — or author a new part on the spot. */
export function AddSectionModal({
  catalog,
  onPick,
  onClose,
  onCreateNew,
  heading,
  emptyHint,
}: AddSectionModalProps) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const [newName, setNewName] = useState<string | null>(null);

  const submitNew = () => {
    const name = (newName ?? "").trim();
    if (!name) {
      setNewName(null);
      return;
    }
    onCreateNew?.(name);
  };

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={heading ?? t("sections.add")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--narrow" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{heading ?? t("sections.add")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="pcms-sectionpalette">
          {catalog.length === 0 && emptyHint && <p className="pcms-empty">{emptyHint}</p>}
          {catalog.map((c) => (
            <button key={c.type} type="button" onClick={() => onPick(c.type)}>
              {c.label}
            </button>
          ))}
        </div>
        {onCreateNew &&
          (newName == null ? (
            <button type="button" className="pcms-sectionpalette__new" onClick={() => setNewName("")}>
              ＋ {t("block.newPart")}
            </button>
          ) : (
            <div className="pcms-sectionpalette__newbox">
              <input
                autoFocus
                className="pcms-filetree__newinput"
                value={newName}
                placeholder={t("block.newPartPlaceholder")}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  else if (e.key === "Escape") setNewName(null);
                }}
              />
              <button type="button" className="pcms-primary" onClick={submitNew}>
                {t("block.create")}
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
