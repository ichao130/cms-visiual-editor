import type { FieldDef, FieldValue } from "@pcms/shared";
import { ImageField } from "./FieldInput.js";
import { BlockEditor } from "./BlockEditor.js";
import { AiRewriteAssist } from "./AiRewriteAssist.js";
import { useMedia } from "../media/MediaContext.js";
import { t } from "../i18n.js";

/** Options a `relation` field can link to, resolved by target content type. */
export type RelationOptions = (type: string | undefined) => {
  value: string;
  label: string;
}[];

interface ContentFieldProps {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: string) => void;
  /** AI rewrite for rich-text fields: given the current text + an instruction. */
  aiRewrite?: (text: string, instruction: string) => Promise<string>;
  /** Items a `relation` field may link to, by target type. */
  relationItems?: RelationOptions;
}

/**
 * One content field rendered from its definition. Covers every field type in
 * the spec (CLAUDE.md カスタムフィールド): text/longtext/richtext, number,
 * date/datetime, image/file, gallery, link, select/multiselect, checkbox,
 * relation, and group (repeating sub-fields).
 */
export function ContentField({ field, value, onChange, aiRewrite, relationItems }: ContentFieldProps) {
  const id = `cf-${field.name}`;
  const str = value == null ? "" : String(value);

  return (
    <label className="pcms-field" htmlFor={id}>
      <span className="pcms-field__label">
        {field.label || field.name}
        {field.required && <em className="pcms-field__req">必須</em>}
      </span>
      {control(id, field, str, onChange, relationItems)}
      {field.type === "richtext" && aiRewrite && str.trim() !== "" && (
        <AiRewriteAssist
          rewrite={(instruction) => aiRewrite(str, instruction)}
          onApply={onChange}
        />
      )}
      {field.description && <small className="pcms-field__desc">{field.description}</small>}
    </label>
  );
}

function control(
  id: string,
  field: FieldDef,
  str: string,
  onChange: (value: string) => void,
  relationItems?: RelationOptions,
) {
  switch (field.type) {
    case "image":
      return <ImageField id={id} value={str} onChange={onChange} />;
    case "richtext":
      return <BlockEditor value={str} onChange={onChange} />;
    case "longtext":
      return (
        <textarea id={id} rows={5} value={str} onChange={(e) => onChange(e.target.value)} />
      );
    case "number":
      return (
        <input id={id} type="number" value={str} onChange={(e) => onChange(e.target.value)} />
      );
    case "date":
      return (
        <input id={id} type="date" value={str} onChange={(e) => onChange(e.target.value)} />
      );
    case "datetime":
      return (
        <input
          id={id}
          type="datetime-local"
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "file":
      // Reuse the media picker; the stored value is the file's path.
      return <ImageField id={id} value={str} onChange={onChange} />;
    case "link":
      // A URL input (type=url) — validated and keyboard-friendly, unlike text.
      return (
        <input
          id={id}
          type="url"
          value={str}
          placeholder="https://"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "relation":
      return (
        <RelationField
          id={id}
          value={str}
          options={relationItems?.(field.relationType) ?? []}
          onChange={onChange}
        />
      );
    case "group":
      return <GroupField id={id} value={str} fields={field.fields ?? []} onChange={onChange} />;
    case "gallery":
      return <GalleryField id={id} value={str} onChange={onChange} />;
    case "multiselect":
      return <MultiSelectField id={id} value={str} options={field.options ?? []} onChange={onChange} />;
    case "checkbox":
      return (
        <input
          id={id}
          type="checkbox"
          className="pcms-field__checkbox"
          checked={str !== "" && str !== "false"}
          onChange={(e) => onChange(e.target.checked ? "true" : "")}
        />
      );
    case "select":
      return (
        <select id={id} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input id={id} type="text" value={str} onChange={(e) => onChange(e.target.value)} />
      );
  }
}

/**
 * Image gallery field: pick several images, reorder, remove. Stored as a
 * comma-separated list of media paths (the engine renders one <img> each).
 */
function GalleryField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { pickImage, resolveUrl } = useMedia();
  const paths = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const commit = (list: string[]) => onChange(list.join(", "));
  const add = async () => {
    const path = await pickImage();
    if (path != null) commit([...paths, path]);
  };
  const removeAt = (i: number) => commit(paths.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const to = i + dir;
    if (to < 0 || to >= paths.length) return;
    const next = [...paths];
    [next[i], next[to]] = [next[to]!, next[i]!];
    commit(next);
  };
  return (
    <div id={id} className="pcms-gallery">
      <div className="pcms-gallery__grid">
        {paths.map((p, i) => (
          <div className="pcms-gallery__item" key={`${p}-${i}`}>
            <img src={resolveUrl(p)} alt="" />
            <div className="pcms-gallery__ops">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title={t("sections.up")}>
                ←
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === paths.length - 1}
                title={t("sections.down")}
              >
                →
              </button>
              <button
                type="button"
                className="pcms-gallery__del"
                onClick={() => removeAt(i)}
                title={t("media.clear")}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="pcms-gallery__add" onClick={add}>
        ＋ {t("gallery.add")}
      </button>
    </div>
  );
}

/**
 * Relation field: link this item to another content item. The value stored is
 * the target item's slug (the theme references it via `data-field`); the picker
 * shows titles. Falls back to a text input when no options are available.
 */
function RelationField({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) {
    return <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type GroupRow = Record<string, string>;

/**
 * Group field: a repeating set of sub-fields. Stored as a JSON array of row
 * objects (string in, string out, like gallery/multiselect), which the engine
 * iterates with `data-loop="<type>.<field>"` and `data-field="item.<sub>"`.
 */
function GroupField({
  id,
  value,
  fields,
  onChange,
}: {
  id: string;
  value: string;
  fields: FieldDef[];
  onChange: (value: string) => void;
}) {
  const rows = parseRows(value);
  const commit = (next: GroupRow[]) => onChange(JSON.stringify(next));
  const addRow = () => commit([...rows, {}]);
  const removeRow = (i: number) => commit(rows.filter((_, idx) => idx !== i));
  const moveRow = (i: number, dir: -1 | 1) => {
    const to = i + dir;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[i], next[to]] = [next[to]!, next[i]!];
    commit(next);
  };
  const setCell = (i: number, key: string, v: string) =>
    commit(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));

  return (
    <div id={id} className="pcms-group">
      {rows.map((row, i) => (
        <div className="pcms-group__row" key={i}>
          <div className="pcms-group__fields">
            {fields.map((sf) => (
              <ContentField
                key={sf.name}
                field={sf}
                value={row[sf.name] ?? ""}
                onChange={(v) => setCell(i, sf.name, v)}
              />
            ))}
          </div>
          <div className="pcms-group__ops">
            <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0} aria-label={t("sections.up")} title={t("sections.up")}>
              ↑
            </button>
            <button type="button" onClick={() => moveRow(i, 1)} disabled={i === rows.length - 1} aria-label={t("sections.down")} title={t("sections.down")}>
              ↓
            </button>
            <button type="button" className="pcms-group__del" onClick={() => removeRow(i)} aria-label={t("repeat.remove")} title={t("repeat.remove")}>
              ×
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="pcms-group__add" onClick={addRow}>
        ＋ {t("group.addRow")}
      </button>
    </div>
  );
}

/** Parse a group field's stored JSON array; tolerate empty / invalid as []. */
function parseRows(value: string): GroupRow[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as GroupRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Multiple-choice field: a checkbox per option. The value is stored as a
 * comma-separated string (so it stringifies the same way an array would when
 * a theme renders the field).
 */
function MultiSelectField({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const selected = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const toggle = (opt: string) => {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    // Keep the option order stable regardless of click order.
    onChange(options.filter((o) => next.includes(o)).join(", "));
  };
  return (
    <div id={id} className="pcms-multiselect">
      {options.length === 0 ? (
        <small className="pcms-field__desc">{t("fieldtype.multiselect.empty")}</small>
      ) : (
        options.map((opt) => (
          <label key={opt} className="pcms-multiselect__opt">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
            {opt}
          </label>
        ))
      )}
    </div>
  );
}
