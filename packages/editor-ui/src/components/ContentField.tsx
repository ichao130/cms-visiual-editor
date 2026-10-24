import type { FieldDef, FieldValue } from "@pcms/shared";
import { ImageField } from "./FieldInput.js";
import { RichTextEditor } from "./RichTextEditor.js";

interface ContentFieldProps {
  field: FieldDef;
  value: FieldValue | undefined;
  onChange: (value: string) => void;
}

/**
 * One content field rendered from its definition. Covers the field types the
 * MVP editor supports; richer types (gallery, relation, group) fall back to a
 * text control for now.
 */
export function ContentField({ field, value, onChange }: ContentFieldProps) {
  const id = `cf-${field.name}`;
  const str = value == null ? "" : String(value);

  return (
    <label className="pcms-field" htmlFor={id}>
      <span className="pcms-field__label">
        {field.label || field.name}
        {field.required && <em className="pcms-field__req">必須</em>}
        <em className="pcms-field__type">{field.type}</em>
      </span>
      {control(id, field, str, onChange)}
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
      return <RichTextEditor value={str} onChange={onChange} />;
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
