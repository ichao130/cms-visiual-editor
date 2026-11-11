import { cssColor, cssIdent, cssValue } from "./css.js";

/**
 * Synthesize the CSS that a WordPress block (FSE) theme relies on but never ships
 * as a stylesheet. A block theme keeps most of its look in `theme.json`: colours,
 * font sizes and spacing live there as *presets*, and WordPress turns them into
 * `--wp--preset--*` custom properties plus `.has-*` utility classes at runtime,
 * then lays blocks out with a small `.wp-block-*` stylesheet. The saved block
 * markup references all of that by class/variable, so without it an imported
 * block theme renders almost unstyled.
 *
 * This produces a *practical* layer (not a byte-for-byte match of WP's style
 * engine): the preset variables, the matching utility classes, a minimal block
 * layout stylesheet, and the theme's own `styles` defaults on `body`. It is
 * prepended to the bundled `assets/style.css` so the theme's own rules (and the
 * operator's overrides) still win the cascade.
 */
export function synthesizeFseCss(themeJsonRaw: string | undefined): { css: string; notes: string[] } {
  const notes: string[] = [];
  if (!themeJsonRaw) return { css: "", notes };
  let data: ThemeJson;
  try {
    data = JSON.parse(themeJsonRaw) as ThemeJson;
  } catch {
    return { css: "", notes };
  }
  const settings = data.settings ?? {};

  const rootDecls: string[] = [];
  const utilities: string[] = [];

  // Colours → --wp--preset--color--<slug> + .has-<slug>-color / -background-color.
  const palette = arr(settings.color?.palette);
  for (const p of palette) {
    const slug = cssIdent(String(p.slug ?? ""));
    const color = cssColor(resolveWpRef(String(p.color ?? "")));
    if (!slug || !color) continue;
    rootDecls.push(`--wp--preset--color--${slug}:${color}`);
    utilities.push(`.has-${slug}-color{color:var(--wp--preset--color--${slug}) !important}`);
    utilities.push(
      `.has-${slug}-background-color{background-color:var(--wp--preset--color--${slug}) !important}`,
    );
  }

  // Gradients → --wp--preset--gradient--<slug> + .has-<slug>-gradient-background.
  for (const g of arr(settings.color?.gradients)) {
    const slug = cssIdent(String(g.slug ?? ""));
    const grad = cssValue(resolveWpRef(String(g.gradient ?? "")));
    if (!slug || !grad) continue;
    rootDecls.push(`--wp--preset--gradient--${slug}:${grad}`);
    utilities.push(`.has-${slug}-gradient-background{background:var(--wp--preset--gradient--${slug}) !important}`);
  }

  // Font sizes → --wp--preset--font-size--<slug> + .has-<slug>-font-size.
  for (const f of arr(settings.typography?.fontSizes)) {
    const slug = cssIdent(String(f.slug ?? ""));
    const size = cssValue(resolveWpRef(fluidSize(f.size)));
    if (!slug || !size) continue;
    rootDecls.push(`--wp--preset--font-size--${slug}:${size}`);
    utilities.push(`.has-${slug}-font-size{font-size:var(--wp--preset--font-size--${slug}) !important}`);
  }

  // Font families → --wp--preset--font-family--<slug> + .has-<slug>-font-family.
  for (const f of arr(settings.typography?.fontFamilies)) {
    const slug = cssIdent(String(f.slug ?? ""));
    const family = cssValue(String(f.fontFamily ?? ""));
    if (!slug || !family) continue;
    rootDecls.push(`--wp--preset--font-family--${slug}:${family}`);
    utilities.push(`.has-${slug}-font-family{font-family:var(--wp--preset--font-family--${slug})}`);
  }

  // Spacing → --wp--preset--spacing--<slug> (referenced by var(), not a utility).
  for (const s of arr(settings.spacing?.spacingSizes)) {
    const slug = cssIdent(String(s.slug ?? ""));
    const size = cssValue(resolveWpRef(String(s.size ?? "")));
    if (!slug || !size) continue;
    rootDecls.push(`--wp--preset--spacing--${slug}:${size}`);
  }

  // Block gap drives the flex gaps in the layout stylesheet below.
  const blockGap = cssValue(resolveWpRef(String(settings.spacing?.blockGap ?? data.styles?.spacing?.blockGap ?? "")));
  if (blockGap) rootDecls.push(`--wp--style--block-gap:${blockGap}`);

  // The theme's own top-level defaults → body (background / text / font).
  const bodyDecls = bodyDefaults(data.styles);

  const chunks: string[] = [];
  if (rootDecls.length) chunks.push(`:root{${rootDecls.join(";")}}`);
  if (bodyDecls) chunks.push(`body{${bodyDecls}}`);
  if (rootDecls.length || bodyDecls) chunks.push(BLOCK_LAYOUT_CSS);
  if (utilities.length) chunks.push(utilities.join("\n"));

  if (chunks.length) {
    notes.push("theme.json のプリセット（色・文字サイズ・余白）から基本CSSを生成しました。");
  }
  return { css: chunks.join("\n"), notes };
}

/**
 * Rewrite WordPress's `theme.json` variable references into real CSS `var()`
 * calls: `var:preset|color|primary` → `var(--wp--preset--color--primary)`,
 * `var:custom|spacing|small` → `var(--wp--custom--spacing--small)`. A value that
 * is already a plain colour/length passes through untouched.
 */
function resolveWpRef(value: string): string {
  return value.replace(/var:([a-z0-9_-]+(?:\|[a-z0-9_-]+)+)/gi, (_m, path: string) => {
    const seg = path
      .split("|")
      .map((s) => cssIdent(s))
      .filter(Boolean)
      .join("--");
    return seg ? `var(--wp--${seg})` : "";
  });
}

/** A fluid font size can be an object `{min,max}`; collapse it to a clamp-ish value. */
function fluidSize(size: unknown): string {
  if (typeof size === "string") return size;
  if (size && typeof size === "object") {
    const o = size as { min?: string; max?: string };
    if (o.max) return o.max; // the upper bound reads well without WP's clamp math
  }
  return "";
}

/** `body{…}` declarations from the theme's top-level `styles` block. */
function bodyDefaults(styles: ThemeJson["styles"]): string {
  if (!styles) return "";
  const decls: string[] = [];
  const bg = cssColor(resolveWpRef(String(styles.color?.background ?? "")));
  if (bg) decls.push(`background-color:${bg}`);
  const text = cssColor(resolveWpRef(String(styles.color?.text ?? "")));
  if (text) decls.push(`color:${text}`);
  const family = cssValue(resolveWpRef(String(styles.typography?.fontFamily ?? "")));
  if (family) decls.push(`font-family:${family}`);
  const size = cssValue(resolveWpRef(String(styles.typography?.fontSize ?? "")));
  if (size) decls.push(`font-size:${size}`);
  const lh = cssValue(String(styles.typography?.lineHeight ?? ""));
  if (lh) decls.push(`line-height:${lh}`);
  return decls.join(";");
}

/**
 * The minimal layout stylesheet WordPress ships for the common structural blocks,
 * so an imported block theme's columns/groups/buttons/alignments lay out instead
 * of stacking as raw divs. Specificity is kept low; the theme's own CSS, prepended
 * after this, overrides it.
 */
const BLOCK_LAYOUT_CSS = [
  ".wp-block-columns{display:flex;flex-wrap:wrap;gap:var(--wp--style--block-gap,1.5rem)}",
  ".wp-block-column{flex:1 1 0%;min-width:0}",
  ".wp-block-group>*,.wp-block-post-content>*{margin-block:var(--wp--style--block-gap,1rem) 0}",
  ".wp-block-buttons{display:flex;flex-wrap:wrap;gap:.5rem}",
  ".wp-block-button__link,.wp-block-button a{display:inline-block;padding:.6em 1.2em;border-radius:4px;text-decoration:none}",
  ".wp-block-image img,.wp-block-post-featured-image img{max-width:100%;height:auto}",
  ".wp-block-navigation>ul,ul.wp-block-navigation{display:flex;flex-wrap:wrap;gap:1rem;list-style:none;margin:0;padding:0}",
  ".has-text-align-center{text-align:center}",
  ".has-text-align-right{text-align:right}",
  ".has-text-align-left{text-align:left}",
  ".aligncenter{margin-left:auto;margin-right:auto}",
  ".alignwide{max-width:min(100%,1200px);margin-left:auto;margin-right:auto}",
  ".alignfull{width:100%}",
].join("\n");

function arr<T>(v: T[] | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

interface ThemeJson {
  settings?: {
    color?: {
      palette?: { slug?: string; color?: string }[];
      gradients?: { slug?: string; gradient?: string }[];
    };
    typography?: {
      fontSizes?: { slug?: string; size?: unknown }[];
      fontFamilies?: { slug?: string; fontFamily?: string }[];
    };
    spacing?: { spacingSizes?: { slug?: string; size?: string }[]; blockGap?: string };
  };
  styles?: {
    color?: { background?: string; text?: string };
    typography?: { fontFamily?: string; fontSize?: string; lineHeight?: string };
    spacing?: { blockGap?: string };
  };
}
