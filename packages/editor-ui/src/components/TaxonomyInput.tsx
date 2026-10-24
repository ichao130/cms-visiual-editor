import { useState } from "react";
import type { TaxonomyDef } from "@pcms/shared";
import { t } from "../i18n.js";

interface TaxonomyInputProps {
  tax: TaxonomyDef;
  value: string[];
  onChange: (terms: string[]) => void;
}

/** Assign taxonomy terms to a content item. */
export function TaxonomyInput({ tax, value, onChange }: TaxonomyInputProps) {
  const [draft, setDraft] = useState("");
  const hasTerms = (tax.terms?.length ?? 0) > 0;

  const toggle = (term: string) => {
    if (tax.multiple) {
      onChange(value.includes(term) ? value.filter((v) => v !== term) : [...value, term]);
    } else {
      onChange(value[0] === term ? [] : [term]);
    }
  };

  const addFree = () => {
    const term = draft.trim();
    if (term && !value.includes(term)) onChange([...value, term]);
    setDraft("");
  };

  return (
    <div className="pcms-field">
      <span className="pcms-field__label">{tax.label}</span>

      {hasTerms ? (
        tax.multiple ? (
          <div className="pcms-terms">
            {tax.terms!.map((term) => (
              <label key={term} className="pcms-terms__check">
                <input
                  type="checkbox"
                  checked={value.includes(term)}
                  onChange={() => toggle(term)}
                />
                {term}
              </label>
            ))}
          </div>
        ) : (
          <select value={value[0] ?? ""} onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}>
            <option value="">—</option>
            {tax.terms!.map((term) => (
              <option key={term} value={term}>
                {term}
              </option>
            ))}
          </select>
        )
      ) : (
        <div className="pcms-tags">
          <div className="pcms-tags__chips">
            {value.map((term) => (
              <span key={term} className="pcms-tags__chip">
                {term}
                <button type="button" onClick={() => onChange(value.filter((v) => v !== term))}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="pcms-tags__add">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFree();
                }
              }}
              placeholder={t("tax.addTerm")}
            />
            <button type="button" onClick={addFree}>
              {t("tax.add")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
