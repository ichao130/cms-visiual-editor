import type { ThemeConfig } from "@pcms/shared";
import type { ThemeTokenGroup } from "../state/mutations.js";
import { t } from "../i18n.js";

/** Preset font stacks offered for the heading / body fonts. */
const FONT_PRESETS: { labelJa: string; value: string }[] = [
  { labelJa: "ゴシック体（和文）", value: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Meiryo', sans-serif" },
  { labelJa: "明朝体（和文）", value: "'Hiragino Mincho ProN', 'Yu Mincho', 'MS Mincho', serif" },
  { labelJa: "丸ゴシック（和文）", value: "'Hiragino Maru Gothic ProN', 'Rounded Mplus 1c', sans-serif" },
  { labelJa: "サンセリフ（欧文）", value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { labelJa: "セリフ（欧文）", value: "Georgia, 'Times New Roman', serif" },
  { labelJa: "等幅", value: "ui-monospace, 'SFMono-Regular', Menlo, monospace" },
];

/** Preset section spacing values (match the sample theme's --space-section). */
const SPACE_PRESETS: { labelKey: Parameters<typeof t>[0]; value: string }[] = [
  { labelKey: "themeStyle.space.narrow", value: "2.5rem" },
  { labelKey: "themeStyle.space.normal", value: "4rem" },
  { labelKey: "themeStyle.space.wide", value: "6rem" },
];

interface Props {
  /** The effective (theme presets + overrides) config, for showing current values. */
  theme: ThemeConfig;
  /** Whether any operator override is set (enables the reset action). */
  overridden: boolean;
  onToken: (group: ThemeTokenGroup, key: string, value: string) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * Site-wide theme style: colors, fonts and spacing, edited as CSS-variable
 * tokens (`settings.theme` overrides, merged over the theme's presets). The
 * live preview re-renders from these, so changes show immediately.
 */
export function ThemeStylePanel({ theme, overridden, onToken, onReset, onClose }: Props) {
  const colors = theme.colors ?? {};
  const fonts = theme.fonts ?? {};
  const spacing = theme.spacing ?? {};

  return (
    <aside className="pcms-settings pcms-themestyle">
      <div className="pcms-themestyle__head">
        <h2 className="pcms-col__title">{t("themeStyle.title")}</h2>
        <button type="button" className="pcms-themestyle__close" onClick={onClose} title={t("themeStyle.close")}>
          ×
        </button>
      </div>
      <p className="pcms-themestyle__hint">{t("themeStyle.hint")}</p>

      <section className="pcms-themestyle__group">
        <h3 className="pcms-themestyle__grouptitle">{t("themeStyle.colors")}</h3>
        <ColorRow label={t("themeStyle.color.primary")} value={colors.primary} onChange={(v) => onToken("colors", "primary", v)} />
        <ColorRow label={t("themeStyle.color.accent")} value={colors.accent} onChange={(v) => onToken("colors", "accent", v)} />
        <ColorRow label={t("themeStyle.color.bg")} value={colors.bg} onChange={(v) => onToken("colors", "bg", v)} />
        <ColorRow label={t("themeStyle.color.text")} value={colors.text} onChange={(v) => onToken("colors", "text", v)} />
      </section>

      <section className="pcms-themestyle__group">
        <h3 className="pcms-themestyle__grouptitle">{t("themeStyle.fonts")}</h3>
        <FontRow label={t("themeStyle.font.heading")} value={fonts.heading} onChange={(v) => onToken("fonts", "heading", v)} />
        <FontRow label={t("themeStyle.font.body")} value={fonts.body} onChange={(v) => onToken("fonts", "body", v)} />
      </section>

      <section className="pcms-themestyle__group">
        <h3 className="pcms-themestyle__grouptitle">{t("themeStyle.spacing")}</h3>
        <label className="pcms-themestyle__row">
          <span className="pcms-themestyle__label">{t("themeStyle.space.section")}</span>
          <select
            className="pcms-themestyle__select"
            value={spacing.section ?? ""}
            onChange={(e) => onToken("spacing", "section", e.target.value)}
          >
            <option value="">{t("themeStyle.font.default")}</option>
            {spacing.section && !SPACE_PRESETS.some((p) => p.value === spacing.section) && (
              <option value={spacing.section}>{spacing.section}</option>
            )}
            {SPACE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.labelKey)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="pcms-themestyle__foot">
        {overridden && <span className="pcms-themestyle__badge">{t("themeStyle.overridden")}</span>}
        <button type="button" className="pcms-themestyle__reset" onClick={onReset} disabled={!overridden}>
          {t("themeStyle.reset")}
        </button>
      </div>
    </aside>
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
    <div className="pcms-themestyle__row">
      <span className="pcms-themestyle__label">{label}</span>
      <input
        type="color"
        className="pcms-themestyle__swatch"
        value={toHex(value) || "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function FontRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const known = FONT_PRESETS.some((p) => p.value === value);
  return (
    <label className="pcms-themestyle__row">
      <span className="pcms-themestyle__label">{label}</span>
      <select className="pcms-themestyle__select" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("themeStyle.font.default")}</option>
        {value && !known && <option value={value}>{value}</option>}
        {FONT_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.labelJa}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A `<input type="color">` needs a #rrggbb value; pass hex through, else "". */
function toHex(value: string | undefined): string {
  if (!value) return "";
  return /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : "";
}
