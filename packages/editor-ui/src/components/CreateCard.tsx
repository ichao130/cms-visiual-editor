import { useState } from "react";
import { t } from "../i18n.js";

interface CreateCardProps {
  /** Label on the collapsed "add" card. */
  label: string;
  /** Placeholder for the name input. */
  placeholder: string;
  /** Called with the trimmed name when the operator confirms. */
  onCreate: (name: string) => void;
}

/**
 * An "add" card that expands into an inline name form (project / site creation).
 * Inline rather than a modal, so the new item appears right where it is added.
 */
export function CreateCard({ label, placeholder, onCreate }: CreateCardProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
    setOpen(false);
  };

  const cancel = () => {
    setName("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button className="pcms-card pcms-card--add" onClick={() => setOpen(true)}>
        ＋ {label}
      </button>
    );
  }

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
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
      />
      <div className="pcms-card__formactions">
        <button type="submit" className="pcms-primary" disabled={!name.trim()}>
          {t("new.create")}
        </button>
        <button type="button" onClick={cancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
