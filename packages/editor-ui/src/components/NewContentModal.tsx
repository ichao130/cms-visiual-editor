import { useState } from "react";
import type { ContentTypeDef } from "@pcms/shared";
import { slugify } from "../state/editorState.js";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

interface NewContentModalProps {
  types: ContentTypeDef[];
  onCreate: (type: string, title: string, slug: string) => void;
  onClose: () => void;
}

/** Modal to create a new content item of a chosen type. */
export function NewContentModal({ types, onCreate, onClose }: NewContentModalProps) {
  const [type, setType] = useState(types[0]?.name ?? "post");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugify(title, type);
  const canCreate = title.trim() !== "" && effectiveSlug.trim() !== "";
  const ref = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("new.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--narrow" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("new.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>

        <label className="pcms-field">
          <span className="pcms-field__label">{t("new.type")}</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((d) => (
              <option key={d.name} value={d.name}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="pcms-field">
          <span className="pcms-field__label">{t("new.titleField")}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <label className="pcms-field">
          <span className="pcms-field__label">{t("new.slug")}</span>
          <input
            value={effectiveSlug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
          />
        </label>

        <div className="pcms-modal__actions">
          <button
            type="button"
            className="pcms-primary"
            disabled={!canCreate}
            onClick={() => onCreate(type, title.trim(), effectiveSlug.trim())}
          >
            {t("new.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
