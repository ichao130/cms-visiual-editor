import type { FieldValue, InlineFieldType } from "@pcms/shared";
import { useMedia } from "../media/MediaContext.js";
import { t } from "../i18n.js";

interface FieldInputProps {
  id: string;
  label: string;
  type: InlineFieldType;
  value: FieldValue | undefined;
  onChange: (value: string) => void;
}

/**
 * One editable field. Image fields use the media library picker; richtext is a
 * markdown textarea for now (a rich-text editor comes later — CLAUDE.md 要相談).
 */
export function FieldInput({ id, label, type, value, onChange }: FieldInputProps) {
  const str = value == null ? "" : String(value);

  return (
    <label className="pcms-field" htmlFor={id}>
      <span className="pcms-field__label">
        {label}
        <em className="pcms-field__type">{type}</em>
      </span>
      {type === "image" ? (
        <ImageField id={id} value={str} onChange={onChange} />
      ) : (
        renderControl(id, type, str, onChange)
      )}
    </label>
  );
}

function ImageField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { pickImage, resolveUrl } = useMedia();
  const thumb = resolveUrl(value);

  const pick = async () => {
    const path = await pickImage();
    if (path != null) onChange(path);
  };

  return (
    <div className="pcms-imagefield" id={id}>
      <button type="button" className="pcms-imagefield__thumb" onClick={pick}>
        {thumb ? (
          <img src={thumb} alt="" />
        ) : (
          <span className="pcms-imagefield__placeholder">{t("media.pick")}</span>
        )}
      </button>
      <div className="pcms-imagefield__actions">
        <button type="button" onClick={pick}>
          {value ? t("media.change") : t("media.pick")}
        </button>
        {value && (
          <button type="button" onClick={() => onChange("")}>
            {t("media.clear")}
          </button>
        )}
      </div>
    </div>
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
        <input id={id} type="number" value={str} onChange={(e) => onChange(e.target.value)} />
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
    case "select":
    case "text":
    default:
      return (
        <input id={id} type="text" value={str} onChange={(e) => onChange(e.target.value)} />
      );
  }
}
