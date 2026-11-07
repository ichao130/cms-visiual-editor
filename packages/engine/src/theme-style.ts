import type { ThemeConfig } from "@pcms/shared";
import { cssColor, cssIdent, cssValue } from "./css.js";

/**
 * Build a `:root` style tag from theme settings so a theme's CSS variables can
 * be driven by `theme.json` presets and the operator's overrides
 * (`settings.theme`). Mapping:
 *   colors.<k>  → --<k>        (e.g. --primary, --accent, --bg, --text)
 *   fonts.<k>   → --font-<k>   (e.g. --font-heading, --font-body)
 *   spacing.<k> → --space-<k>  (e.g. --space-section)
 *
 * Values are sanitized. An empty / absent config yields "" (no tag), so themes
 * that don't define tokens render exactly as before (their stylesheet's own
 * `:root` defaults apply).
 */
export function themeStyleTag(config: ThemeConfig | undefined): string {
  const body = themeRootCss(config);
  return body ? `<style data-pcms-theme>${body}</style>` : "";
}

/** The `:root{…}` rule (without the <style> wrapper), or "" when empty. */
export function themeRootCss(config: ThemeConfig | undefined): string {
  if (!config) return "";
  const decls: string[] = [];
  collect(decls, config.colors, "", cssColor);
  collect(decls, config.fonts, "font-", cssValue);
  collect(decls, config.spacing, "space-", cssValue);
  return decls.length ? `:root{${decls.join(";")}}` : "";
}

/**
 * The effective theme config: the theme's presets (theme.json) overlaid by the
 * operator's overrides (settings.theme). Each token group is shallow-merged, so
 * an override that sets only `colors.primary` keeps the preset's other colors.
 */
export function mergeThemeConfig(
  base: ThemeConfig | undefined,
  override: ThemeConfig | undefined,
): ThemeConfig {
  if (!override) return base ?? {};
  if (!base) return override;
  return {
    name: override.name ?? base.name,
    colors: { ...base.colors, ...override.colors },
    fonts: { ...base.fonts, ...override.fonts },
    spacing: { ...base.spacing, ...override.spacing },
  };
}

function collect(
  out: string[],
  values: Record<string, string> | undefined,
  prefix: string,
  sanitize: (v: string) => string,
): void {
  for (const [key, raw] of Object.entries(values ?? {})) {
    const name = cssIdent(key);
    const val = sanitize(String(raw ?? ""));
    if (name && val) out.push(`--${prefix}${name}:${val}`);
  }
}
