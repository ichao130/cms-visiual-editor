import { useState } from "react";
import { t } from "../i18n.js";

interface CardRenameFormProps {
  /** Current name, shown prefilled and selected for editing. */
  initial: string;
  /** Called with the trimmed new name (only when it differs from initial). */
  onRename: (name: string) => void;
  /** Called when the operator cancels (Escape or the cancel button). */
  onCancel: () => void;
}

/**
 * Inline rename form shown in place of a project / site card. Mirrors
 * CreateCard's inline style so renaming happens right where the item sits,
 * without a modal.
 */
export function CardRenameForm({ initial, onRename, onCancel }: CardRenameFormProps) {
  const [name, setName] = useState(initial);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed !== initial) onRename(trimmed);
    else onCancel();
  };

  return (
    <form
      className="pcms-card pcms-card--form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="pcms-card__formactions">
        <button type="submit" className="pcms-primary" disabled={!name.trim()}>
          {t("common.save")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
