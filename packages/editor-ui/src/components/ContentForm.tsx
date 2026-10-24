import type { ContentItem, InlineFieldType } from "@pcms/shared";
import { FieldInput } from "./FieldInput.js";
import { t } from "../i18n.js";

interface ContentFormProps {
  item: ContentItem;
  onChange: (key: string, value: string) => void;
}

const RESERVED = new Set(["title", "date", "url"]);

/**
 * Editing form for a content item (post / static page). The MVP exposes the
 * common fields — title, date (posts) and the markdown body — plus any extra
 * string fields the item already carries. A full custom-field UI follows with
 * content-type definitions.
 */
export function ContentForm({ item, onChange }: ContentFormProps) {
  const showDate = item.type === "post" || item.fields.date != null;
  const extras = Object.keys(item.fields).filter((k) => !RESERVED.has(k));

  return (
    <aside className="pcms-settings">
      <h2 className="pcms-col__title">{t("content.title")}</h2>

      <FieldInput
        id="content-title"
        label={t("content.field.title")}
        type="text"
        value={item.fields.title}
        onChange={(v) => onChange("title", v)}
      />

      {showDate && (
        <FieldInput
          id="content-date"
          label={t("content.field.date")}
          type="text"
          value={item.fields.date}
          onChange={(v) => onChange("date", v)}
        />
      )}

      {extras.map((key) => (
        <FieldInput
          key={key}
          id={`content-${key}`}
          label={key}
          type={"text" as InlineFieldType}
          value={item.fields[key]}
          onChange={(v) => onChange(key, v)}
        />
      ))}

      <FieldInput
        id="content-body"
        label={t("content.field.body")}
        type="richtext"
        value={item.body}
        onChange={(v) => onChange("body", v)}
      />
    </aside>
  );
}
