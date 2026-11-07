/**
 * Small CSS value sanitizers shared by the renderer (per-section inline styles)
 * and theme-style (the `:root` token block). Kept in their own module so both
 * can import them without a cycle.
 */

/** Keep only characters valid in a CSS color so the value can't break out. */
export function cssColor(value: string): string {
  return value.replace(/[^#a-zA-Z0-9(),.%\s-]/g, "").trim();
}

/**
 * Sanitize a free-form CSS value (font stack, length, etc.): drop characters
 * that could terminate the declaration or inject markup. Commas, quotes and
 * spaces are kept so font stacks like `'Hiragino Mincho ProN', serif` survive.
 */
export function cssValue(value: string): string {
  return value.replace(/[;{}<>\\\r\n]/g, "").trim();
}

/** Keep only identifier-safe characters for a custom-property name segment. */
export function cssIdent(name: string): string {
  return name.replace(/[^a-zA-Z0-9-]/g, "");
}
