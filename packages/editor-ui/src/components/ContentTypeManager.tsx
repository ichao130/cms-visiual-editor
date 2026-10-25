import { useState } from "react";
import type { ContentTypeDef, FieldDef, FieldType } from "@pcms/shared";
import { slugify } from "../state/editorState.js";
import { useDialog } from "../state/useDialog.js";
import { t } from "../i18n.js";

interface ContentTypeManagerProps {
  types: ContentTypeDef[];
  onCommit: (types: ContentTypeDef[]) => void;
  onClose: () => void;
}

const BUILTIN = new Set(["post", "page"]);
const FIELD_TYPES: FieldType[] = [
  "text",
  "longtext",
  "richtext",
  "number",
  "date",
  "image",
  "select",
  "checkbox",
  "link",
];

/** GUI to define custom post types and their fields (content-types.json). */
export function ContentTypeManager({ types, onCommit, onClose }: ContentTypeManagerProps) {
  const [selected, setSelected] = useState(types[0]?.name ?? "");
  const [newLabel, setNewLabel] = useState("");

  const current = types.find((t2) => t2.name === selected) ?? types[0];

  const updateType = (name: string, patch: Partial<ContentTypeDef>) =>
    onCommit(types.map((tp) => (tp.name === name ? { ...tp, ...patch } : tp)));

  const setFields = (name: string, fields: FieldDef[]) => updateType(name, { fields });

  const addType = () => {
    const label = newLabel.trim();
    if (!label) return;
    const name = slugify(label, "type");
    if (types.some((tp) => tp.name === name)) return;
    const def: ContentTypeDef = {
      name,
      label,
      fields: [{ name: "title", label: "タイトル", type: "text", required: true }],
    };
    onCommit([...types, def]);
    setSelected(name);
    setNewLabel("");
  };

  const deleteType = (name: string) => {
    if (BUILTIN.has(name)) return;
    if (!window.confirm(t("types.deleteConfirm"))) return;
    const next = types.filter((tp) => tp.name !== name);
    onCommit(next);
    setSelected(next[0]?.name ?? "");
  };

  const addField = () => {
    if (!current) return;
    const fields = [
      ...current.fields,
      { name: uniqueFieldName(current.fields), label: "新しい項目", type: "text" as FieldType },
    ];
    setFields(current.name, fields);
  };

  const updateField = (idx: number, patch: Partial<FieldDef>) => {
    if (!current) return;
    setFields(
      current.name,
      current.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    );
  };

  const removeField = (idx: number) => {
    if (!current) return;
    setFields(current.name, current.fields.filter((_, i) => i !== idx));
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    if (!current) return;
    const to = idx + dir;
    if (to < 0 || to >= current.fields.length) return;
    const fields = [...current.fields];
    [fields[idx], fields[to]] = [fields[to] as FieldDef, fields[idx] as FieldDef];
    setFields(current.name, fields);
  };

  const ref = useDialog<HTMLDivElement>(onClose);

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("types.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div className="pcms-modal__panel pcms-modal__panel--wide" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("types.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
          </button>
        </header>

        <div className="pcms-types">
          <div className="pcms-types__list">
            {types.map((tp) => (
              <button
                key={tp.name}
                type="button"
                className={`pcms-types__item${tp.name === selected ? " is-selected" : ""}`}
                onClick={() => setSelected(tp.name)}
              >
                {tp.label}
                <span className="pcms-types__name">{tp.name}</span>
              </button>
            ))}
            <div className="pcms-types__add">
              <input
                placeholder={t("types.newLabel")}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button type="button" onClick={addType} disabled={!newLabel.trim()}>
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
                  onChange={(e) => updateType(current.name, { label: e.target.value })}
                />
              </label>

              <h3 className="pcms-types__fieldshead">{t("types.fields")}</h3>
              {current.fields.map((f, i) => (
                <fieldset className="pcms-fielddef" key={i}>
                  <div className="pcms-fielddef__row">
                    <input
                      className="pcms-fielddef__name"
                      value={f.name}
                      onChange={(e) => updateField(i, { name: e.target.value })}
                      disabled={f.name === "title"}
                      placeholder="name"
                    />
                    <input
                      value={f.label}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                      placeholder="ラベル"
                    />
                    <select
                      value={f.type}
                      onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                    >
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft} value={ft}>
                          {ft}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pcms-fielddef__row">
                    <label className="pcms-fielddef__req">
                      <input
                        type="checkbox"
                        checked={f.required === true}
                        onChange={(e) => updateField(i, { required: e.target.checked })}
                      />
                      {t("types.required")}
                    </label>
                    {f.type === "select" && (
                      <input
                        className="pcms-fielddef__options"
                        value={(f.options ?? []).join(", ")}
                        onChange={(e) =>
                          updateField(i, {
                            options: e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder={t("types.options")}
                      />
                    )}
                    <div className="pcms-fielddef__actions">
                      <button type="button" onClick={() => moveField(i, -1)} disabled={i === 0}>
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(i, 1)}
                        disabled={i === current.fields.length - 1}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="pcms-danger"
                        onClick={() => removeField(i)}
                        disabled={f.name === "title"}
                      >
                        {t("repeat.remove")}
                      </button>
                    </div>
                  </div>
                </fieldset>
              ))}
              <button type="button" className="pcms-types__addfield" onClick={addField}>
                {t("types.addField")}
              </button>

              {!BUILTIN.has(current.name) && (
                <button
                  type="button"
                  className="pcms-danger pcms-types__deletetype"
                  onClick={() => deleteType(current.name)}
                >
                  {t("types.deleteType")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function uniqueFieldName(fields: FieldDef[]): string {
  let n = fields.length + 1;
  let name = `field${n}`;
  const names = new Set(fields.map((f) => f.name));
  while (names.has(name)) {
    n += 1;
    name = `field${n}`;
  }
  return name;
}
