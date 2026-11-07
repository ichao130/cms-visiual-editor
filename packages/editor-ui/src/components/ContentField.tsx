import type { FieldDef, FieldValue } from "@pcms/shared";
import { ImageField } from "./FieldInput.js";
import { BlockEditor } from "./BlockEditor.js";
import { AiRewriteAssist } from "./AiRewriteAssist.js";
import { useMedia } from "../media/MediaContext.js";
import { t } from "../i18n.js";

interface ContentFieldProps {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: string) => void;
  /** AI rewrite for rich-text fields: given the current text + an instruction. */
  aiRewrite?: (text: string, instruction: string) => Promise<string>;
}

/**
 * One content field rendered from its definition. Covers the field types the
 * MVP editor supports; richer types (gallery, relation, group) fall back to a
 * text control for now.
 */
export function ContentField({ field, value, onChange, aiRewrite }: ContentFieldProps) {
  const id = `cf-${field.name}`;
  const str = value == null ? "" : String(value);

  return (
    <label className="pcms-field" htmlFor={id}>
      <span className="pcms-field__label">
        {field.label || field.name}
        {field.required && <em className="pcms-field__req">必須</em>}
      </span>
      {control(id, field, str, onChange)}
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
