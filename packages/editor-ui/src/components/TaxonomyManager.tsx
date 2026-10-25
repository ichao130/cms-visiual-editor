import { useState } from "react";
import type { ContentTypeDef, TaxonomyDef } from "@pcms/shared";
import { slugify } from "../state/editorState.js";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

interface TaxonomyManagerProps {
  taxonomies: TaxonomyDef[];
  contentTypes: ContentTypeDef[];
  onCommit: (taxonomies: TaxonomyDef[]) => void;
  onClose: () => void;
}

/** GUI to define classifications (categories / tags / custom). */
export function TaxonomyManager({
  taxonomies,
  contentTypes,
  onCommit,
  onClose,
}: TaxonomyManagerProps) {
  const [selected, setSelected] = useState(taxonomies[0]?.name ?? "");
  const [newLabel, setNewLabel] = useState("");

  const current = taxonomies.find((tx) => tx.name === selected) ?? taxonomies[0];

  const update = (name: string, patch: Partial<TaxonomyDef>) =>
    onCommit(taxonomies.map((tx) => (tx.name === name ? { ...tx, ...patch } : tx)));

  const addTax = () => {
    const label = newLabel.trim();
    if (!label) return;
    const name = slugify(label, "tax");
    if (taxonomies.some((tx) => tx.name === name)) return;
    onCommit([...taxonomies, { name, label, types: [], multiple: true }]);
    setSelected(name);
    setNewLabel("");
  };

  const deleteTax = (name: string) => {
    if (!window.confirm(t("tax.deleteConfirm"))) return;
    const next = taxonomies.filter((tx) => tx.name !== name);
    onCommit(next);
    setSelected(next[0]?.name ?? "");
  };

  const toggleType = (type: string) => {
    if (!current) return;
    const types = current.types.includes(type)
      ? current.types.filter((x) => x !== type)
      : [...current.types, type];
    update(current.name, { types });
  };

  const ref = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("tax.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--wide" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("tax.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>

        <div className="pcms-types">
          <div className="pcms-types__list">
            {taxonomies.map((tx) => (
              <button
                key={tx.name}
                type="button"
                className={`pcms-types__item${tx.name === selected ? " is-selected" : ""}`}
                onClick={() => setSelected(tx.name)}
              >
                {tx.label}
                <span className="pcms-types__name">{tx.name}</span>
              </button>
            ))}
            <div className="pcms-types__add">
              <input
                placeholder={t("tax.newLabel")}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button type="button" onClick={addTax} disabled={!newLabel.trim()}>
                {t("types.add")}
              </button>
            </div>
          </div>

          {current && (
            <div className="pcms-types__detail">
              <label className="pcms-field">
                <span className="pcms-field__label">{t("types.label")}</span>
                <input
                  value={current.label}
                  onChange={(e) => update(current.name, { label: e.target.value })}
                />
              </label>

              <span className="pcms-field__label">{t("tax.appliesTo")}</span>
              <div className="pcms-terms">
                {contentTypes.map((ct) => (
                  <label key={ct.name} className="pcms-terms__check">
                    <input
                      type="checkbox"
                      checked={current.types.includes(ct.name)}
                      onChange={() => toggleType(ct.name)}
                    />
                    {ct.label}
                  </label>
                ))}
              </div>

              <label className="pcms-field">
                <span className="pcms-field__label">{t("tax.terms")}</span>
                <input
                  value={(current.terms ?? []).join(", ")}
                  onChange={(e) =>
                    update(current.name, {
                      terms: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder={t("tax.termsHint")}
                />
              </label>

              <label className="pcms-fielddef__req">
                <input
                  type="checkbox"
                  checked={current.multiple === true}
                  onChange={(e) => update(current.name, { multiple: e.target.checked })}
                />
                {t("tax.multiple")}
              </label>

              <button
                type="button"
                className="pcms-danger pcms-types__deletetype"
                onClick={() => deleteTax(current.name)}
              >
                {t("tax.delete")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
