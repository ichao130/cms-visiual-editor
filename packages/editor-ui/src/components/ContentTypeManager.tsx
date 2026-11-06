import { useState } from "react";
import type { ContentTypeDef, FieldDef, FieldType } from "@pcms/shared";
import { slugify } from "../state/editorState.js";
import { useDragReorder, moveItem } from "../state/useDragReorder.js";
import { CommaListInput } from "./CommaListInput.js";
import { t, type MessageKey } from "../i18n.js";
import { Icon } from "./Icon.js";

interface ContentTypeManagerProps {
  types: ContentTypeDef[];
  onCommit: (types: ContentTypeDef[]) => void;
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

/** Japanese labels for the field types offered above. */
const FIELD_TYPE_LABEL: Partial<Record<FieldType, MessageKey>> = {
  text: "fieldtype.text",
  longtext: "fieldtype.longtext",
  richtext: "fieldtype.richtext",
  number: "fieldtype.number",
  date: "fieldtype.date",
  image: "fieldtype.image",
  select: "fieldtype.select",
  checkbox: "fieldtype.checkbox",
  link: "fieldtype.link",
};

/** GUI to define custom post types and their fields (content-types.json). */
export function ContentTypeManager({ types, onCommit }: ContentTypeManagerProps) {
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
  const dnd = useDragReorder((from, to) => {
    if (current) setFields(current.name, moveItem(current.fields, from, to));
  });

  return (
    <div className="pcms-structpage">
      <h1 className="pcms-page__title">{t("types.title")}</h1>
      <p className="pcms-structpage__hint">{t("types.hint")}</p>

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
                <fieldset className="pcms-fielddef" key={i} {...dnd.zoneProps(i)}>
                  <div className="pcms-fielddef__row">
                    <span
                      className="pcms-draghandle"
                      aria-label={t("common.drag")}
                      title={t("common.drag")}
                      {...dnd.handleProps(i)}
                    >
                      <Icon name="grip" size={15} />
                    </span>
                    <input
                      className="pcms-fielddef__name"
                      value={f.name}
                      onChange={(e) => updateField(i, { name: e.target.value })}
                      disabled={f.name === "title"}
                      placeholder={t("types.fieldName")}
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
                          {FIELD_TYPE_LABEL[ft] ? t(FIELD_TYPE_LABEL[ft]) : ft}
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
                      <CommaListInput
                        className="pcms-fielddef__options"
                        value={f.options ?? []}
                        onChange={(options) => updateField(i, { options })}
                        placeholder={t("types.options")}
                      />
                    )}
                    <div className="pcms-fielddef__actions">
                      <button type="button" onClick={() => moveField(i, -1)} disabled={i === 0}>
                        <Icon name="chevron-up" size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveField(i, 1)}
                        disabled={i === current.fields.length - 1}
                      >
                        <Icon name="chevron-down" size={15} />
                      </button>
                      <button
                        type="button"
                        className="pcms-delbtn"
                        onClick={() => removeField(i)}
                        disabled={f.name === "title"}
                        title={t("repeat.remove")}
                        aria-label={t("repeat.remove")}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                </fieldset>
              ))}
              <button type="button" className="pcms-types__addfield" onClick={addField}>
                <Icon name="plus" size={14} /> {t("types.addField")}
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
