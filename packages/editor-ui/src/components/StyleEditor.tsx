import type { SectionStyle } from "@pcms/shared";
import { t } from "../i18n.js";

interface Props {
  style: SectionStyle | undefined;
  onChange: (patch: Partial<SectionStyle>) => void;
}

type Padding = NonNullable<SectionStyle["paddingY"]>;

/** Per-section visual overrides: background, text color, vertical spacing. */
export function StyleEditor({ style, onChange }: Props) {
  const s = style ?? {};
  return (
    <div className="pcms-style">
      <h3 className="pcms-style__title">{t("style.title")}</h3>
      <ColorRow
        label={t("style.background")}
        value={s.background}
        onChange={(v) => onChange({ background: v })}
      />
      <ColorRow
        label={t("style.textColor")}
        value={s.textColor}
        onChange={(v) => onChange({ textColor: v })}
      />
      <label className="pcms-style__row">
        <span className="pcms-style__label">{t("style.padding")}</span>
        <select
          value={s.paddingY ?? ""}
          onChange={(e) =>
            onChange({ paddingY: e.target.value === "" ? undefined : (e.target.value as Padding) })
          }
        >
          <option value="">{t("style.default")}</option>
          <option value="none">{t("style.none")}</option>
          <option value="sm">{t("style.sm")}</option>
          <option value="md">{t("style.md")}</option>
          <option value="lg">{t("style.lg")}</option>
        </select>
      </label>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="pcms-style__row">
      <span className="pcms-style__label">{label}</span>
      <input
        type="color"
        className="pcms-style__swatch"
        value={value || "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button type="button" className="pcms-style__clear" onClick={() => onChange("")}>
          {t("style.clear")}
        </button>
      ) : (
        <span className="pcms-style__default">{t("style.default")}</span>
      )}
    </div>
  );
}
