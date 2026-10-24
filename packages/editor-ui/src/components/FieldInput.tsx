import type { FieldValue, InlineFieldType } from "@pcms/shared";

interface FieldInputProps {
  id: string;
  label: string;
  type: InlineFieldType;
  value: FieldValue | undefined;
  onChange: (value: string) => void;
}

/**
 * One editable field. Types we don't fully build yet (richtext, image, select)
 * fall back to a sensible text control for the MVP; a rich-text editor and a
 * media picker come later (CLAUDE.md: 記事本文のエディタは未定, 導入前に相談).
 */
export function FieldInput({ id, label, type, value, onChange }: FieldInputProps) {
  const str = value == null ? "" : String(value);

  return (
    <label className="pcms-field" htmlFor={id}>
      <span className="pcms-field__label">
        {label}
        <em className="pcms-field__type">{type}</em>
      </span>
      {renderControl(id, type, str, onChange)}
    </label>
  );
}

function renderControl(
  id: string,
  type: InlineFieldType,
  str: string,
  onChange: (value: string) => void,
) {
  switch (type) {
    case "richtext":
      return (
        <textarea
          id={id}
          rows={5}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "color":
      return (
        <input
          id={id}
          type="color"
          value={str || "#000000"}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "link":
    case "image":
    case "select":
    case "text":
    default:
      return (
        <input
          id={id}
          type="text"
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
