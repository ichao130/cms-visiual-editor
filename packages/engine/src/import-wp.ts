import { parse, type HTMLElement } from "node-html-parser";
import type { ThemeConfig } from "@pcms/shared";
import { themeifyHtml, validateThemeHtml, type AiIssue } from "./ai.js";
import { addBlockSlots, relabelSections } from "./import.js";

/**
 * WordPress-aware theme import. Unlike the generic single-blob `importThemeHtml`
 * (which strips PHP / template directives / comments and extracts a body), this
 * understands a whole WordPress theme — classic PHP themes (the template
 * hierarchy + template tags like the_title/the_content) and block themes
 * (theme.json + Gutenberg `<!-- wp:… -->` markup) — and produces a self-
 * contained pcms theme: layout.html + templates + theme.json tokens, with the
 * site's CSS kept verbatim. Pure: text in, strings out, no I/O. The caller
 * unzips the archive (the engine never touches zip/fs); PHP never reaches the
 * output (CLAUDE.md). The goal is fidelity — reproduce the original as closely
 * as a static site can.
 */

/** One text entry from an unzipped theme archive (path relative to the zip). */
export interface WpImportFile {
  path: string;
  text: string;
}

/** The pcms theme a WordPress theme was converted into (strings only). */
export interface WpThemeFiles {
  "theme.json"?: string;
  "layout.html"?: string;
  /** templates/<name>.html — keyed by pcms template name (index/post/page/archive). */
  templates: Record<string, string>;
  /** sections/<slug>.html — reusable sections (reserved; usually empty for MVP). */
  sections: Record<string, string>;
  /** blocks/<type>.html — reusable blocks (reserved). */
  blocks: Record<string, string>;
  /** Image/asset base names referenced by the produced HTML (for the UI to inline). */
  assets: string[];
  /**
   * Base names of the stylesheets the theme ACTUALLY loads, in load order — the
   * CSS the UI should fold into assets/style.css, and ONLY that CSS. Empty when
   * the theme referenced none (the UI then folds every CSS as a fallback). See
   * collectEnqueuedStyles.
   */
  styles: string[];
  /**
   * The theme's default page composition as a JSON `{ pages, regions }` string
   * (SiteSettings shape), written to `presets/pages.json`. Lists the home page and
   * every imported 固定ページ (each naming its own template). presetSettingsFor reads
   * it when the theme becomes active. Absent only for themes we produced none for.
   */
  preset?: string;
}

/**
 * What the post-import wizard needs to let the operator confirm the shape of the
 * import before it becomes a theme: which template is the site's top page (a theme
 * can ship front-page / home / index), which 固定ページ to create, and what the
 * theme fills dynamically (Customizer / custom functions / post loops) that a
 * theme ZIP can't carry — so the operator knows to fill those in after importing.
 */
export interface WpImportWizard {
  /** Candidate top-page templates present in the theme; `chosen` is the default. */
  home: { chosen: string; candidates: { stem: string; label: string; html: string }[] };
  /** The importable 固定ページ (each a template + default title); the operator toggles these. */
  pages: { id: string; template: string; title: string }[];
  /** Content the theme renders dynamically and the ZIP does not contain — fill after import. */
  unresolved: string[];
}

export interface WpImportResult {
  kind: "classic" | "block" | "mixed" | "unknown";
  files: WpThemeFiles;
  issues: AiIssue[];
  notes: string[];
  /** Data for the import wizard (top-page choice, pages, unresolved content). */
  wizard: WpImportWizard;
}

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
}
function stemOf(path: string): string {
  return baseName(path).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}
function hasFile(files: WpImportFile[], re: RegExp): boolean {
  return files.some((f) => re.test(f.path.replace(/\\/g, "/")));
}

/** Theme subdirectories that hold patterns/parts/includes, never hierarchy templates. */
const NON_HIERARCHY_DIR = /(^|\/)(patterns|parts|template-parts|templates|inc|includes|src|build|assets|vendor|node_modules)\//i;
/** The classic template-hierarchy and chrome stems (a block theme has none at its root). */
const CLASSIC_STEM = /^(index|single|singular|page|archive|category|tag|taxonomy|author|search|404|front-page|home|header|footer|sidebar)$/i;

/**
 * True when the archive carries a real classic template-hierarchy PHP file —
 * one at the theme root (not a Gutenberg *pattern* like `patterns/footer.php`,
 * which only looks like `footer.php`). Block themes register patterns as PHP, so
 * matching those as a classic signal is what made FSE themes misclassify as mixed.
 */
function hasClassicTemplate(files: WpImportFile[]): boolean {
  return files.some((f) => {
    const p = f.path.replace(/\\/g, "/");
    if (!/\.php$/i.test(p)) return false;
    if (NON_HIERARCHY_DIR.test(p)) return false;
    return CLASSIC_STEM.test(stemOf(p));
  });
}

/**
 * Classify a WordPress theme archive: a block theme ships `theme.json` plus
 * `templates/*.html` (and usually `parts/*.html`); a classic theme ships PHP
 * template files (index.php/style.css with a theme header). A block theme wins
 * even when it also ships pattern/part PHP — only a real root-level PHP hierarchy
 * alongside block templates is genuinely "mixed".
 */
export function detectWpThemeKind(files: WpImportFile[]): WpImportResult["kind"] {
  // Block themes are defined by theme.json + templates/*.html (they also ship a
  // style.css header, so that header alone is not a classic signal).
  const block =
    hasFile(files, /(^|\/)theme\.json$/i) &&
    hasFile(files, /(^|\/)templates\/[^/]+\.html$/i);
  // Classic themes are defined by their root-level PHP template files, ignoring
  // the pattern/part PHP a block theme ships (those are not hierarchy templates).
  const classic = hasClassicTemplate(files);
  if (block) return classic ? "mixed" : "block";
  if (classic) return "classic";
  // A style.css theme header with no templates we recognise.
  if (hasFile(files, /(^|\/)style\.css$/i) && files.some((f) => /Theme Name\s*:/i.test(f.text))) {
    return "classic";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Gutenberg block comments (`<!-- wp:… -->`)
// ---------------------------------------------------------------------------

export interface WpBlock {
  name: string;
  attrs: Record<string, unknown>;
  innerHtml: string;
  inner: WpBlock[];
}

const WP_TOKEN =
  /<!--\s*(\/?)wp:([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?)\s*(\{[\s\S]*?\})?\s*(\/)?\s*-->/gi;

/**
 * Tokenize Gutenberg block markup into a tree. Each block keeps its saved inner
 * HTML and nested child blocks. Malformed JSON attrs default to `{}` and never
 * throw; unclosed blocks are flushed so partial markup still parses.
 */
export function parseGutenberg(html: string): WpBlock[] {
  const roots: WpBlock[] = [];
  const stack: WpBlock[] = [];
  const addFreeform = (text: string): void => {
    if (text && stack.length > 0) stack[stack.length - 1]!.innerHtml += text;
  };
  const push = (blk: WpBlock): void => {
    (stack.length > 0 ? stack[stack.length - 1]!.inner : roots).push(blk);
  };

  let last = 0;
  let m: RegExpExecArray | null;
  WP_TOKEN.lastIndex = 0;
  while ((m = WP_TOKEN.exec(html)) !== null) {
    addFreeform(html.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const json = m[3];
    const selfClose = m[4] === "/";
    if (closing) {
      const blk = stack.pop();
      if (blk) push(blk);
      continue;
    }
    let attrs: Record<string, unknown> = {};
    if (json) {
      try {
        attrs = JSON.parse(json) as Record<string, unknown>;
      } catch {
        attrs = {};
      }
    }
    // Core blocks omit the namespace in markup (`wp:heading` = core/heading).
    const qualified = name.includes("/") ? name : `core/${name}`;
    const blk: WpBlock = { name: qualified, attrs, innerHtml: "", inner: [] };
    if (selfClose) push(blk);
    else stack.push(blk);
  }
  while (stack.length > 0) push(stack.pop()!);
  return roots;
}

/**
 * The dynamic-menu list item shared by the classic `wp_nav_menu` mapping and the
 * block `core/navigation` mapping: one `<li data-loop="menu">` the engine repeats
 * per menu entry. Kept in one place so both import paths produce the same markup.
 */
const MENU_LOOP_ITEM =
  '<li data-loop="menu"><a data-field="item.url" data-type="link" href="#">' +
  '<span data-field="item.label" data-type="text" data-label="ラベル">メニュー</span></a></li>';

/** Add data-field/type/label to the first matching element in a fragment. */
function annotate(fragment: string, selector: string, field: string, type: string, label: string): string {
  const root = parse(fragment || "", { comment: false });
  const el = root.querySelectorAll(selector)[0];
  if (!el) return fragment;
  if (el.getAttribute("data-field") == null) {
    el.setAttribute("data-field", field);
    el.setAttribute("data-type", type);
    el.setAttribute("data-label", label);
    if (el.tagName?.toLowerCase() === "img") {
      if (el.getAttribute("src") == null) el.setAttribute("src", "");
      if (el.getAttribute("alt") == null) el.setAttribute("alt", "");
    }
  }
  return root.toString();
}

/**
 * Context for `gutenbergToHtml`: lets `core/template-part` resolve a referenced
 * `parts/<slug>.html` and inline it. `skipChromeParts` drops header/footer parts
 * when rendering a template BODY (the layout owns the chrome), and the `seen` set
 * guards against a part that references itself.
 */
export interface BlockRenderCtx {
  /** slug (lowercased) → raw part HTML, from `parts/<slug>.html`. */
  parts: Map<string, string>;
  /** Drop `core/template-part` for header/footer (layout renders those). */
  skipChromeParts: boolean;
  /** Recursion guard: part slugs currently being inlined. */
  seen: Set<string>;
}

/** The `slug` a `core/template-part` block points at (e.g. "header", "footer"). */
function templatePartSlug(attrs: Record<string, unknown>): string {
  const slug = attrs.slug ?? attrs.theme ?? "";
  return typeof slug === "string" ? slug.toLowerCase().replace(/^.*\//, "") : "";
}

/**
 * Render a Gutenberg block tree to pcms-annotated HTML. Core text/media blocks
 * become editable `data-field` elements; container blocks (group/columns) keep
 * their structure and recurse; the chrome blocks (`site-logo`/`site-title`/
 * `navigation`) become the same editable markup their classic equivalents do; a
 * `template-part` is inlined from `ctx.parts`; a `query`/`post-template` becomes a
 * `data-loop="posts"` list; unknown blocks keep their saved HTML verbatim
 * (fidelity over cleverness). A later `importThemeHtml` pass wraps the result in
 * `data-section`s and adds block slots.
 */
export function gutenbergToHtml(blocks: WpBlock[], ctx?: Partial<BlockRenderCtx>): string {
  const parts = ctx?.parts ?? new Map<string, string>();
  const skipChromeParts = ctx?.skipChromeParts ?? false;
  const seen = ctx?.seen ?? new Set<string>();
  let n = 0;
  const field = (base: string): string => `${base}${++n}`;
  const render = (blk: WpBlock): string => {
    const inner = blk.inner.map(render).join("\n");
    switch (blk.name) {
      case "core/paragraph":
        return annotate(blk.innerHtml || "<p></p>", "p", field("text"), "richtext", "本文");
      case "core/heading":
        return annotate(blk.innerHtml || "<h2></h2>", "h1,h2,h3,h4,h5,h6", field("heading"), "text", "見出し");
      case "core/image":
        return annotate(blk.innerHtml || '<img src="" alt="" />', "img", field("image"), "image", "画像");
      case "core/post-featured-image":
        return `<img data-field="post.image" data-type="image" data-label="アイキャッチ" src="" alt="" />`;
      case "core/button": {
        const html = blk.innerHtml || '<a class="btn" href="#"></a>';
        return annotate(html, "a", field("link"), "link", "ボタンのリンク");
      }
      case "core/post-title":
        return `<h1 data-field="post.title" data-type="text" data-label="タイトル"></h1>`;
      case "core/post-content":
        return `<div data-slot="content" data-field="post.body" data-type="richtext" data-label="本文"></div>`;
      case "core/post-excerpt":
        return `<p data-field="post.excerpt" data-type="text" data-label="抜粋"></p>`;
      case "core/post-date":
        return `<p data-field="post.date" data-type="text" data-label="日付"></p>`;
      case "core/site-title":
        return `<span data-field="site.name" data-type="text" data-label="サイト名"></span>`;
      case "core/site-logo":
        return (
          '<a class="site-logo" data-field="site.name" data-type="link" href="#">' +
          '<img data-field="site.logo" data-type="image" data-label="ロゴ" src="" alt="" /></a>'
        );
      case "core/navigation":
        return `<ul class="wp-block-navigation">${MENU_LOOP_ITEM}</ul>`;
      case "core/query":
        // The wrapper: the post-template inside carries the data-loop.
        return `<div class="wp-block-query">${inner}</div>`;
      case "core/post-template":
        // One iteration of the loop; the engine repeats it per post.
        return `<div class="wp-block-post" data-loop="posts" data-limit="10">${inner}</div>`;
      case "core/template-part": {
        const slug = templatePartSlug(blk.attrs);
        if (skipChromeParts && /header|footer/.test(slug)) return ""; // layout owns chrome
        if (!slug || seen.has(slug)) return inner;
        const raw = parts.get(slug);
        if (raw == null) return inner; // part not in the archive
        seen.add(slug);
        const out = gutenbergToHtml(parseGutenberg(raw), { parts, skipChromeParts, seen });
        seen.delete(slug);
        return out;
      }
      case "core/group":
      case "core/columns":
      case "core/column":
      case "core/cover":
      case "core/buttons":
        return `<div>${inner}${blk.innerHtml.trim()}</div>`;
      case "core/list":
      case "core/quote":
      case "core/table":
      case "core/separator":
      case "core/spacer":
      case "core/html":
        return blk.innerHtml + inner;
      default:
        // Unknown block: keep its saved HTML so appearance is preserved.
        return blk.innerHtml + inner;
    }
  };
  return blocks.map(render).join("\n");
}

/** Map of `parts/<slug>.html` by lowercased slug, for template-part inlining. */
function collectBlockParts(files: WpImportFile[]): Map<string, string> {
  const parts = new Map<string, string>();
  for (const f of files) {
    const m = /(^|\/)parts\/([^/]+)\.html$/i.exec(f.path.replace(/\\/g, "/"));
    if (m) parts.set((m[2] ?? "").toLowerCase(), f.text);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// theme.json tokens
// ---------------------------------------------------------------------------

function pickBySlug(entries: { slug: string; value: string }[], keys: string[]): string | undefined {
  for (const k of keys) {
    const hit = entries.find((e) => e.slug.toLowerCase().includes(k));
    if (hit) return hit.value;
  }
  return undefined;
}

/**
 * Map a WordPress `theme.json` to pcms's `{name, colors, fonts, spacing}` token
 * shape. Lossy but safe: recognised palette slugs fill primary/accent/bg/text,
 * the rest pass through under `colors["<slug>"]`; unknowns never throw.
 */
export function wpThemeJsonToKumito(raw: string): { config: ThemeConfig; notes: string[] } {
  const notes: string[] = [];
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { config: {}, notes: ["theme.json を解釈できませんでした。"] };
  }
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const config: ThemeConfig = {};

  const title = (data.title ?? data.name) as string | undefined;
  if (typeof title === "string" && title.trim()) config.name = title.trim();

  const palette = ((settings.color as Record<string, unknown> | undefined)?.palette ?? []) as {
    slug?: string;
    color?: string;
  }[];
  const colorEntries = palette
    .filter((p) => typeof p.slug === "string" && typeof p.color === "string")
    .map((p) => ({ slug: p.slug as string, value: p.color as string }));
  if (colorEntries.length > 0) {
    const colors: Record<string, string> = {};
    const primary = pickBySlug(colorEntries, ["primary", "accent", "brand"]);
    const accent = pickBySlug(colorEntries, ["secondary", "accent", "link"]);
    const bg = pickBySlug(colorEntries, ["background", "base", "bg"]);
    const text = pickBySlug(colorEntries, ["foreground", "text", "contrast", "dark"]);
    if (primary) colors.primary = primary;
    if (accent && accent !== primary) colors.accent = accent;
    if (bg) colors.bg = bg;
    if (text) colors.text = text;
    for (const e of colorEntries) {
      if (![primary, accent, bg, text].includes(e.value)) colors[e.slug] = e.value;
    }
    config.colors = colors;
    notes.push(`配色（${colorEntries.length}色）をテーマ設定に取り込みました。`);
  }

  const families = ((settings.typography as Record<string, unknown> | undefined)?.fontFamilies ?? []) as {
    slug?: string;
    fontFamily?: string;
  }[];
  const fontEntries = families
    .filter((f) => typeof f.fontFamily === "string")
    .map((f) => ({ slug: (f.slug as string) ?? "", value: f.fontFamily as string }));
  if (fontEntries.length > 0) {
    const fonts: Record<string, string> = {};
    fonts.heading = pickBySlug(fontEntries, ["heading", "display", "title"]) ?? fontEntries[0]!.value;
    fonts.body = pickBySlug(fontEntries, ["body", "text", "base"]) ?? fontEntries[0]!.value;
    config.fonts = fonts;
    notes.push("フォントをテーマ設定に取り込みました。");
  }

  const spacingSizes = ((settings.spacing as Record<string, unknown> | undefined)?.spacingSizes ?? []) as {
    size?: string;
  }[];
  const blockGap = (settings.spacing as Record<string, unknown> | undefined)?.blockGap as string | undefined;
  const sectionSpace =
    spacingSizes.length > 0 ? spacingSizes[spacingSizes.length - 1]?.size : blockGap;
  if (typeof sectionSpace === "string" && sectionSpace.trim()) {
    config.spacing = { section: sectionSpace };
  }

  return { config, notes };
}

/** Read the `Theme Name:` from a classic theme's style.css header. */
export function parseStyleCssName(css: string): string | undefined {
  const m = /Theme Name\s*:\s*(.+)/i.exec(css);
  return m?.[1]?.trim() || undefined;
}

// ---------------------------------------------------------------------------
// Classic PHP — template tags + includes
// ---------------------------------------------------------------------------

interface TagRule {
  re: RegExp;
  repl: string;
  note?: string;
}

/** A PHP call to one of the named WP functions, e.g. `<?php echo the_title(); ?>`. */
function phpCall(names: string): RegExp {
  return new RegExp(`<\\?php\\s+(?:echo\\s+)?(?:${names})\\s*\\([\\s\\S]*?\\)\\s*;?\\s*\\?>`, "gi");
}

/** The editable title field injected for `the_title` / `get_the_title`. */
const TITLE_FIELD = '<span data-field="post.title" data-type="text" data-label="タイトル"></span>';

const TAG_RULES: TagRule[] = [
  { re: phpCall("the_title|get_the_title"), repl: TITLE_FIELD },
  { re: phpCall("the_content"), repl: '<div data-slot="content" data-field="post.body" data-type="richtext" data-label="本文"></div>' },
  { re: phpCall("the_excerpt|get_the_excerpt"), repl: '<span data-field="post.excerpt" data-type="text" data-label="抜粋"></span>' },
  { re: phpCall("the_post_thumbnail|get_the_post_thumbnail"), repl: '<img data-field="post.image" data-type="image" data-label="アイキャッチ" src="" alt="" />' },
  { re: phpCall("the_date|the_time|get_the_date|get_the_time"), repl: '<span data-field="post.date" data-type="text" data-label="日付"></span>' },
  { re: phpCall("bloginfo|get_bloginfo"), repl: '<span data-field="site.name" data-type="text" data-label="サイト名"></span>' },
];

/** PHP that is removed (engine injects head/lang; permalinks become #). */
const TAG_REMOVE: RegExp[] = [
  phpCall("wp_head|wp_footer|body_class|language_attributes|post_class"),
  phpCall("the_custom_logo"),
];

/**
 * Neutralize any PHP that sits INSIDE an HTML attribute value, so the element-
 * producing rules below never inject a `<span>` into an attribute (which would
 * corrupt the whole document when it is parsed — the classic cause of a theme's
 * `<head>`/`<!doctype>` leaking into a layout slot). `charset` gets a real
 * value; every other attribute keeps its literal text with the PHP removed.
 */
function neutralizePhpInAttributes(input: string): string {
  let s = input;
  // charset="<?php bloginfo('charset'); ?>" → charset="utf-8"
  s = s.replace(/\bcharset\s*=\s*(["'])\s*<\?php[\s\S]*?\?>\s*\1/gi, 'charset="utf-8"');
  // Any attr="…<?php…?>…" / attr='…<?php…?>…' → drop the PHP, keep the literal.
  const stripIn = (quote: string) =>
    new RegExp(`([\\w:-]+)\\s*=\\s*${quote}([^${quote}]*)${quote}`, "g");
  const clean = (m: string, name: string, val: string, q: string): string =>
    val.includes("<?php") ? `${name}=${q}${val.replace(/<\?php[\s\S]*?\?>/g, "").trim()}${q}` : m;
  s = s.replace(stripIn('"'), (m, name, val) => clean(m, name, val, '"'));
  s = s.replace(stripIn("'"), (m, name, val) => clean(m, name, val, "'"));
  return s;
}

// A single PHP scalar literal: '…' / "…" / number / true / false.
const PHP_LIT = `'(?:\\\\.|[^'\\\\])*'|"(?:\\\\.|[^"\\\\])*"|-?\\d+(?:\\.\\d+)?|true|false`;

/** A PHP scalar literal → its display string (best-effort), or undefined. */
function phpLiteral(raw: string): string | undefined {
  const t = raw.trim();
  if (t === "true") return "true";
  if (t === "false") return "";
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return t;
  const dq = /^"([\s\S]*)"$/.exec(t);
  if (dq)
    return (dq[1] ?? "")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "")
      .replace(/\\"/g, '"')
      .replace(/\\\$/g, "$")
      .replace(/\\\\/g, "\\");
  const sq = /^'([\s\S]*)'$/.exec(t);
  if (sq) return (sq[1] ?? "").replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  return undefined;
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The theme's own default Customizer / theme-mod values, mined statically from
 * its PHP. A theme ZIP carries DESIGN, not the site's DB content — but the text
 * a fresh install shows (hero copy, CTA band, …) lives in the theme's own
 * defaults: `get_theme_mod('k', <default>)`, `add_setting('k', ['default'=>…])`,
 * or an _s-style field table `'k' => array( __('label'), '<default>', 'type' )`.
 * Recovering those lets the top page import POPULATED instead of blank.
 */
export interface ThemeModDefaults {
  /** Getter fns that take a mod key (always includes `get_theme_mod`). */
  wrappers: Set<string>;
  /** mod key → default display text. */
  values: Map<string, string>;
}

export function collectThemeModDefaults(files: WpImportFile[]): ThemeModDefaults {
  // get_option / get_field / the_field are the other common getter names a theme
  // reads option values through (theme-options frameworks, ACF). Echoes that call
  // them — or a `$var = get_field('k')` assignment — resolve to a default below.
  const wrappers = new Set<string>(["get_theme_mod", "get_option", "get_field", "the_field"]);
  const values = new Map<string, string>();
  const set = (key: string, raw: string): void => {
    const v = phpLiteral(raw);
    if (key && v !== undefined && v !== "" && !values.has(key)) values.set(key, v);
  };
  // ACF field groups saved as JSON (acf-json/*.json): name + default_value.
  const mineAcfJson = (raw: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === "object") {
        const o = node as Record<string, unknown>;
        if (typeof o.name === "string" && typeof o.default_value === "string") {
          set(o.name, JSON.stringify(o.default_value)); // re-quote so phpLiteral reads it
        }
        Object.values(o).forEach(walk);
      }
    };
    walk(parsed);
  };
  for (const f of files) {
    if (/(^|\/)acf-json\/.*\.json$/i.test(f.path.replace(/\\/g, "/"))) {
      mineAcfJson(f.text);
      continue;
    }
    if (!/\.php$/i.test(f.path)) continue;
    const text = f.text;
    // Wrapper getters: `function foo( $key ) { … get_theme_mod( $key … ) … }`.
    const fnRe = /function\s+([a-z_]\w*)\s*\(\s*\$[a-z_]\w*\s*\)/gi;
    let fm: RegExpExecArray | null;
    while ((fm = fnRe.exec(text)) !== null) {
      if (/get_theme_mod\s*\(|get_option\s*\(/.test(text.slice(fm.index, fm.index + 800)))
        wrappers.add(fm[1]!);
    }
    // Only mine defaults from files that configure options (Customizer / Kirki /
    // theme-options / ACF). A theme's templates rarely hold defaults, so this gate
    // keeps the positional-array heuristic off ordinary data arrays.
    if (!/get_theme_mod|add_setting|customiz|kirki|get_option|acf_add_local_field|default_value/i.test(text))
      continue;
    let m: RegExpExecArray | null;
    // get_theme_mod('key', <literal>) and get_option('key', <literal>).
    const gm = new RegExp(`get_(?:theme_mod|option)\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*(${PHP_LIT})`, "gi");
    while ((m = gm.exec(text)) !== null) set(m[1]!, m[2]!);
    // add_setting('key', array( … 'default' => <literal> … )).
    const as = new RegExp(`add_setting\\s*\\(\\s*['"]([^'"]+)['"]\\s*,\\s*array\\(([\\s\\S]*?)\\)`, "gi");
    while ((m = as.exec(text)) !== null) {
      const d = new RegExp(`['"]default['"]\\s*=>\\s*(${PHP_LIT})`, "i").exec(m[2] ?? "");
      if (d) set(m[1]!, d[1]!);
    }
    // Kirki: a field config carrying 'settings'=>'key' and a sibling 'default'=>…
    // (Kirki::add_field([...]) or new Kirki\Field\…([...])). Kirki's idiom lists
    // 'default' AFTER 'settings', so scan forward only — bounded by the NEXT
    // 'settings' key — so one field never borrows the previous field's default.
    const kk = new RegExp(`['"]settings['"]\\s*=>\\s*['"]([^'"]+)['"]`, "gi");
    while ((m = kk.exec(text)) !== null) {
      const start = m.index + m[0].length;
      const next = text.slice(start).search(/['"]settings['"]\s*=>/i);
      const window = text.slice(start, next === -1 ? start + 300 : start + next);
      const d = new RegExp(`['"]default['"]\\s*=>\\s*(${PHP_LIT})`, "i").exec(window);
      if (d) set(m[1]!, d[1]!);
    }
    // ACF registered in PHP: 'name' => 'key' … 'default_value' => <literal> (same field array).
    const acf = new RegExp(`['"]name['"]\\s*=>\\s*['"]([^'"]+)['"][\\s\\S]{0,400}?['"]default_value['"]\\s*=>\\s*(${PHP_LIT})`, "gi");
    while ((m = acf.exec(text)) !== null) set(m[1]!, m[2]!);
    // _s-style field table: 'key' => array( __('label'[, 'domain']) | <lit>, '<default>', … )
    const firstEl = `__\\(\\s*(?:${PHP_LIT})\\s*(?:,\\s*(?:${PHP_LIT})\\s*)?\\)|${PHP_LIT}`;
    const pa = new RegExp(`['"]([a-z0-9_]+)['"]\\s*=>\\s*array\\(\\s*(?:${firstEl})\\s*,\\s*(${PHP_LIT})`, "gi");
    while ((m = pa.exec(text)) !== null) set(m[1]!, m[2]!);
  }
  return { wrappers, values };
}

/**
 * Replace `<?php echo … ?>` tags that print a theme-mod (directly, or via a
 * `$var = wrapper('key')` assignment earlier in the same template) with the
 * theme's own default text, so the editable field imports pre-filled. Only
 * echoes resolving to a known default are touched; everything else is left for
 * the normal PHP strip. `nl2br` in the tag → newlines become `<br>`.
 */
function resolveThemeModEchoes(input: string, defs: ThemeModDefaults): { html: string; hit: boolean } {
  if (defs.values.size === 0) return { html: input, hit: false };
  let hit = false;
  const wrapperAlt = [...defs.wrappers].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Local `$var = wrapper('key')` → the mod key it holds.
  const varKey = new Map<string, string>();
  const asgn = new RegExp(`\\$([a-z_]\\w*)\\s*=\\s*(?:${wrapperAlt})\\s*\\(\\s*['"]([^'"]+)['"]`, "gi");
  let a: RegExpExecArray | null;
  while ((a = asgn.exec(input)) !== null) {
    if (defs.values.has(a[2]!)) varKey.set(a[1]!, a[2]!);
  }
  const render = (key: string, tag: string): string => {
    const esc = htmlEscape(defs.values.get(key) ?? "");
    hit = true;
    return /nl2br/i.test(tag) ? esc.replace(/\r?\n/g, "<br>") : esc.replace(/\r?\n/g, " ");
  };
  const direct = new RegExp(`(?:${wrapperAlt})\\s*\\(\\s*['"]([^'"]+)['"]`, "i");
  let html = input.replace(/<\?php\s+echo\b[\s\S]*?\?>|<\?=[\s\S]*?\?>/gi, (tag) => {
    const d = direct.exec(tag);
    if (d && defs.values.has(d[1]!)) return render(d[1]!, tag);
    for (const [v, key] of varKey) {
      if (new RegExp(`\\$${v}\\b`).test(tag)) return render(key, tag);
    }
    return tag;
  });
  // ACF `the_field('k')` / WP `the_option(...)` print directly (no `echo`), so a
  // whole-tag replacement is safe when the tag is just that one printing call.
  html = html.replace(
    /<\?php\s+the_field\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/gi,
    (tag, key: string) => (defs.values.has(key) ? render(key, tag) : tag),
  );
  return { html, hit };
}

/**
 * Convert the common WordPress template tags into pcms `data-field` bindings
 * before the PHP is stripped — this is the fidelity core for classic themes.
 * Permalinks collapse to `#`, asset-path helpers collapse to a relative path
 * (so `normalizeAssets` can fold them into `assets/`), menus become a dynamic
 * `data-loop="menu"`. PHP inside an attribute is neutralized first (never turned
 * into an element). Anything left is removed later, so no PHP reaches the output.
 */
export function mapTemplateTags(html: string, defs?: ThemeModDefaults): { html: string; notes: string[] } {
  const notes: string[] = [];
  let s = html;
  // Pre-fill editable fields from the theme's own Customizer defaults BEFORE the
  // tag rules run (so a `$hero_title` echo becomes text, not an empty <span>).
  if (defs) {
    const r = resolveThemeModEchoes(s, defs);
    s = r.html;
    if (r.hit) notes.push("テーマの初期値（カスタマイザー）を編集欄に取り込みました。");
  }
  const apply = (re: RegExp, repl: string, note: string): void => {
    if (re.test(s)) {
      s = s.replace(re, repl);
      notes.push(note);
    }
    re.lastIndex = 0;
  };

  // Asset path helpers inside a URL: drop the PHP, keep the trailing path.
  s = s.replace(
    /<\?php\s+(?:echo\s+)?(?:get_template_directory_uri|get_stylesheet_directory_uri|get_theme_file_uri|get_stylesheet_uri|home_url|site_url|esc_url)\s*\([\s\S]*?\)\s*;?\s*\?>/gi,
    "",
  );
  // Permalinks (often inside href="…").
  s = s.replace(phpCall("the_permalink|get_permalink|get_the_permalink"), "#");

  // Neutralize PHP left inside attributes BEFORE any element-producing rule,
  // so an attribute never receives a <span data-field> (which breaks parsing).
  s = neutralizePhpInAttributes(s);

  // wp_nav_menu(...) → a dynamic menu that matches the theme's own markup. WP
  // outputs `<container class="container_class"><ul class="menu_class" id="menu_id">
  // <li><a>…</a></li>…</ul></container>`, and the theme's CSS + nav toggle target
  // that `<ul>` (e.g. `.gnav`). Emitting a bare `<nav><a>` instead left the menu
  // unstyled and the hamburger pointing at nothing. Honour the container args and
  // put `data-loop="menu"` on the `<li>`, so each menu item becomes a styled <li>.
  if (/wp_nav_menu/i.test(s)) {
    const arg = (args: string, key: string): string | undefined =>
      new RegExp(`['"]${key}['"]\\s*=>\\s*['"]([^'"]*)['"]`, "i").exec(args)?.[1];
    s = s.replace(
      /<\?php\s+(?:echo\s+)?wp_nav_menu\s*\(([\s\S]*?)\)\s*;?\s*\?>/gi,
      (_m, args: string) => {
        const container = (arg(args, "container") ?? "ul").toLowerCase();
        const cls = arg(args, "container_class") ?? arg(args, "menu_class") ?? "";
        const id = arg(args, "menu_id") ?? "";
        const attrs = `${cls ? ` class="${cls}"` : ""}${id ? ` id="${id}"` : ""}`;
        const ul = `<ul${attrs}>${MENU_LOOP_ITEM}</ul>`;
        return container === "ul" ? ul : `<${container}>${ul}</${container}>`;
      },
    );
    notes.push("メニュー（wp_nav_menu）を動的メニューに変換しました。");
  }

  // the_title( '<h1 class="…">', '</h1>' ) — keep the heading wrapper the theme
  // chose (its class carries the styling) rather than flattening the whole call to
  // a bare <span>. When the wrapper is a single element, the field goes on it;
  // otherwise the field is nested inside the given markup.
  if (/the_title\s*\(\s*['"]/i.test(s)) {
    s = s.replace(
      /<\?php\s+(?:echo\s+)?the_title\s*\(\s*(['"])([\s\S]*?)\1\s*(?:,\s*(['"])([\s\S]*?)\3\s*)?\)\s*;?\s*\?>/gi,
      (_m, _q1: string, before: string, _q3: string, after?: string) => {
        const open = /^\s*<([a-z0-9]+)([^>]*)>\s*$/i.exec(before || "");
        if (open && after && new RegExp(`^\\s*</${open[1]}>\\s*$`, "i").test(after)) {
          return `<${open[1]}${open[2]} data-field="post.title" data-type="text" data-label="タイトル"></${open[1]}>`;
        }
        return `${before ?? ""}${TITLE_FIELD}${after ?? ""}`;
      },
    );
    notes.push("見出しタグ付きのタイトルを維持しました。");
  }

  for (const rule of TAG_RULES) apply(rule.re, rule.repl, `WordPressのテンプレートタグを編集項目に変換しました。`);
  for (const re of TAG_REMOVE) s = s.replace(re, "");

  // De-duplicate the generic conversion note.
  const uniq = [...new Set(notes)];
  return { html: s, notes: uniq };
}

/**
 * A `get_template_part` / `get_sidebar` include, matched ANYWHERE — not only as
 * its own `<?php … ?>` tag. _s-based themes wrap the content include in the loop
 * `<?php while ( have_posts() ) : the_post(); get_template_part(…); endwhile; ?>`,
 * so a tag-anchored match misses it and the body is lost to PHP stripping. The
 * args may hold one level of nested parens, e.g. `get_post_type()`.
 */
const PART_CALL_RE = /(get_template_part|get_sidebar)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*;?/gi;

/** Candidate part stems for an include, in WP's resolution order. */
function partCandidates(fn: string, rawArgs: string): string[] {
  const strings = [...rawArgs.matchAll(/(['"])([^'"]+)\1/g)].map((m) => m[2]!);
  if (/sidebar/i.test(fn)) {
    const name = strings[0];
    return [name ? `sidebar-${name}` : "", "sidebar"].filter(Boolean);
  }
  // get_template_part(slug, name) → slug-name.php then slug.php. `name` may be a
  // non-literal (a function call like get_post_type()); then only slug.php is tried.
  const slug = strings[0] ?? "";
  const name = strings[1];
  return [name ? `${slug}-${name}` : "", slug].filter(Boolean);
}

/**
 * Inline get_template_part / get_sidebar includes wherever they appear, including
 * inside the have_posts() loop. Each call is replaced with `?>…part HTML…<?php`,
 * which splits the enclosing PHP block so the part lands as real markup (the
 * residual `<?php … ?>` fragments are stripped later). Recursion-guarded via `seen`.
 */
function inlineParts(
  s: string,
  files: Map<string, string>,
  seen: Set<string>,
  expand: (html: string) => string,
): string {
  return s.replace(PART_CALL_RE, (_m, fn: string, rawArgs: string) => {
    for (const c of partCandidates(fn, rawArgs)) {
      const key = c.toLowerCase();
      const found = files.get(`${c}.php`) ?? files.get(baseName(c) + ".php");
      if (found === undefined) continue;
      if (seen.has(key)) return ""; // already inlined on this branch — stop recursion
      seen.add(key);
      return `?>${expand(found)}<?php`;
    }
    return "";
  });
}

/**
 * Inline a classic theme's PHP includes so one template file is a whole page:
 * `get_header()` → header.php, `get_footer()` → footer.php,
 * `get_template_part('x','y')` → x-y.php / x.php. Recursion-guarded.
 */
export function composeClassicTemplate(stem: string, files: Map<string, string>): string {
  const seen = new Set<string>();
  const resolve = (name: string): string => {
    const key = name.toLowerCase();
    if (seen.has(key)) return "";
    seen.add(key);
    const text = files.get(`${key}.php`) ?? files.get(key) ?? "";
    return expand(text);
  };
  const expand = (html: string): string => {
    let s = html;
    s = s.replace(phpCall("get_header"), () => resolve("header"));
    s = s.replace(phpCall("get_footer"), () => resolve("footer"));
    s = inlineParts(s, files, seen, expand);
    return s;
  };
  const start = files.get(`${stem}.php`) ?? "";
  return expand(start);
}

// ---------------------------------------------------------------------------
// Layout composition + asset collection
// ---------------------------------------------------------------------------

/** The pcms layout.html skeleton (same shape as the sample theme). */
function layoutSkeleton(
  headerMarkup: string,
  footerMarkup: string,
  lang: string,
  scriptTags = "",
  externalStyleTags = "",
): string {
  return (
    `<!doctype html>\n<html lang="${lang}">\n  <head>\n` +
    `    <meta charset="utf-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `    <title data-field="site.name"></title>\n` +
    (externalStyleTags ? `${externalStyleTags}\n` : "") +
    `    <link rel="stylesheet" href="/assets/style.css" />\n` +
    `  </head>\n  <body>\n` +
    `    <div data-slot="header">${headerMarkup}</div>\n\n` +
    `    <main data-slot="content"></main>\n\n` +
    `    <div data-slot="footer">${footerMarkup}</div>\n` +
    (scriptTags ? `${scriptTags}\n` : "") +
    `  </body>\n</html>\n`
  );
}

/**
 * The scripts a classic theme ACTUALLY loads, from `wp_enqueue_script(...)` /
 * `wp_register_script(...)` in any PHP file. A WordPress theme ships a whole
 * vendor folder (e.g. a dozen `anime.*.js` versions, both `jquery.js` and a CDN
 * copy, `slick.js` + `slick.min.js`); loading all of them — which auto-linking
 * every `assets/*.js` would do — breaks the page with conflicting globals and is
 * nothing like the live site. Only the enqueued set loads; the rest are carried
 * but never linked. External (CDN) URLs are kept verbatim; local paths collapse
 * to `/assets/<basename>` (the flattened asset folder).
 */
export function collectEnqueuedScripts(
  files: WpImportFile[],
): { external: boolean; base: string; url: string }[] {
  const seen = new Set<string>();
  const out: { external: boolean; base: string; url: string }[] = [];
  const call = /wp_(?:enqueue|register)_script\s*\(/gi;
  for (const f of files) {
    if (!/\.php$/i.test(f.path)) continue;
    let m: RegExpExecArray | null;
    call.lastIndex = 0;
    while ((m = call.exec(f.text)) !== null) {
      // The statement argument list (up to the terminating `;`, capped so a
      // missing semicolon can't run away). The URL is the one string literal
      // whose path ends in `.js`; the handle literal does not.
      const windowText = f.text.slice(m.index, m.index + 500);
      const end = windowText.indexOf(";");
      const args = end >= 0 ? windowText.slice(0, end) : windowText;
      const lit = /(['"])(.*?)\1/g;
      let s: RegExpExecArray | null;
      while ((s = lit.exec(args)) !== null) {
        const raw = (s[2] ?? "").trim();
        const path = raw.split(/[?#]/)[0] ?? "";
        if (!/\.js$/i.test(path)) continue;
        const external = /^(https?:)?\/\//i.test(raw);
        const base = baseName(path);
        if (!external && !base) continue;
        const key = external ? raw : base;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ external, base, url: external ? raw : `/assets/${base}` });
      }
    }
  }
  return out;
}

/**
 * The stylesheets a theme ACTUALLY loads, in load order — the CSS counterpart of
 * collectEnqueuedScripts, and the single biggest fidelity lever. A WordPress
 * theme archive ships far more CSS than it uses: vendor libraries it never
 * enqueues (a 100 KB bootstrap, slick, rellax), a JS library's own documentation-
 * site CSS, and the RTL mirror (style-rtl.css, loaded only for RTL locales).
 * Folding ALL of them into one stylesheet lets that dead CSS win the cascade —
 * global resets and demo-page body rules override the real design — so the import
 * looks nothing like the original. So, exactly as with scripts, take only the CSS
 * the theme references: `<link rel="stylesheet">` in its templates (header/footer),
 * and wp_enqueue_style / wp_register_style (get_stylesheet_uri() = the theme's own
 * style.css). External (CDN) URLs are kept verbatim for a layout <link>; local
 * paths collapse to their basename (the flattened asset folder), first seen wins.
 */
export function collectEnqueuedStyles(
  files: WpImportFile[],
): { external: boolean; base: string; url: string }[] {
  const seen = new Set<string>();
  const out: { external: boolean; base: string; url: string }[] = [];
  const add = (raw0: string): void => {
    const raw = raw0.trim();
    const path = raw.split(/[?#]/)[0] ?? "";
    if (!/\.css$/i.test(path)) return;
    const external = /^(https?:)?\/\//i.test(raw);
    const base = baseName(path);
    if (!external && !base) return;
    // style-rtl.css is the RTL mirror WP loads only for RTL locales; pulling it
    // into an LTR import would flip/override the real rules.
    if (!external && /-rtl\.css$/i.test(base)) return;
    const key = external ? raw : base.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ external, base, url: external ? raw : base });
  };
  // A WordPress theme archive bundles whole vendor libraries, each with its own
  // demo/documentation HTML full of <link> tags to that library's CSS. Those are
  // not the theme's templates, so scanning them would pull in exactly the dead CSS
  // we're trying to exclude. Only the theme's own source counts: its PHP, and (for
  // block themes) templates/*.html + parts/*.html.
  const path = (f: WpImportFile): string => f.path.replace(/\\/g, "/");
  const isVendor = (p: string): boolean =>
    /(^|\/)(vendors?|node_modules|bower_components)\//i.test(p);
  const isTemplateHtml = (p: string): boolean => /(^|\/)(templates|parts)\/[^/]+\.html$/i.test(p);
  // 1) <link rel="stylesheet" href="…"> in a template. PHP is stripped first so an
  //    asset-path helper inside the href (`href="<?php … ?>/css/x.css"`) — whose
  //    `?>` would otherwise truncate the tag at its `>` and lose the URL — leaves
  //    a plain path behind.
  const linkRe = /<link\b[^>]*>/gi;
  const hrefRe = /href\s*=\s*(['"])([\s\S]*?)\1/i;
  for (const f of files) {
    const p = path(f);
    if (isVendor(p)) continue;
    if (!/\.php$/i.test(p) && !isTemplateHtml(p)) continue;
    const noPhp = f.text.replace(/<\?[\s\S]*?\?>/g, "");
    for (const tag of noPhp.match(linkRe) ?? []) {
      if (!/\brel\s*=\s*(['"])[^'"]*stylesheet[^'"]*\1/i.test(tag)) continue;
      const h = hrefRe.exec(tag);
      if (h) add(h[2] ?? "");
    }
  }
  // 2) wp_enqueue_style / wp_register_style(handle, src, …). The src is the one
  //    string literal ending in .css; get_stylesheet_uri() → the theme's style.css.
  const enqRe = /wp_(?:enqueue|register)_style\s*\(/gi;
  for (const f of files) {
    if (isVendor(path(f))) continue;
    if (!/\.php$/i.test(f.path)) continue;
    let m: RegExpExecArray | null;
    enqRe.lastIndex = 0;
    while ((m = enqRe.exec(f.text)) !== null) {
      const windowText = f.text.slice(m.index, m.index + 600);
      const end = windowText.indexOf(";");
      const args = end >= 0 ? windowText.slice(0, end) : windowText;
      if (/get_stylesheet_uri\s*\(/i.test(args)) add("style.css");
      const lit = /(['"])(.*?)\1/g;
      let s: RegExpExecArray | null;
      while ((s = lit.exec(args)) !== null) add((s[2] ?? "").trim());
    }
  }
  return out;
}

/** Basenames of scripts a markup fragment already loads with `<script src>`. */
function inlineScriptBases(markup: string): Set<string> {
  const bases = new Set<string>();
  for (const m of markup.matchAll(/<script\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1/gi)) {
    const base = baseName((m[2] ?? "").split(/[?#]/)[0] ?? "");
    if (base) bases.add(base);
  }
  return bases;
}

/** Rewrite one local asset URL to `assets/<file>`; leave external/inline refs. */
function localizeAssetUrl(url: string): string {
  const u = url.trim();
  if (u === "" || u.startsWith("#") || /^(https?:)?\/\//i.test(u) || /^data:/i.test(u)) return url;
  if (/^(mailto:|tel:|javascript:)/i.test(u)) return url;
  const base = u.split("#")[0]?.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";
  // Root-absolute so a reference works from any page depth (the generator serves
  // theme assets at /assets/, as the layout's own /assets/style.css link does).
  return base ? `/assets/${base}` : url;
}

/**
 * Rewrite local `url(...)` references inside a stylesheet to `/assets/<file>`.
 * A theme's CSS points at fonts and background images with relative paths like
 * `../fonts/x.woff` or `./ajax-loader.gif`; once every asset is flattened into
 * `/assets/`, those must be re-pointed or they 404 (missing fonts/backgrounds —
 * a major fidelity loss). External URLs, data URIs and `url(#id)` SVG refs are
 * left untouched.
 */
export function localizeCssUrls(css: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, _q, raw) => {
    const u = String(raw).trim();
    if (u === "" || u.startsWith("#") || u.startsWith("data:") || /^(https?:)?\/\//i.test(u)) return m;
    const base = u.split("#")[0]?.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";
    return base ? `url("/assets/${base}")` : m;
  });
}

/** Normalize every local asset reference in a parsed tree to `assets/<file>`. */
function normalizeWpAssets(root: HTMLElement): void {
  for (const el of root.querySelectorAll("img,source,script,link,a,use,embed,video,audio,track")) {
    for (const attr of ["src", "href", "poster", "data-src", "xlink:href"]) {
      const v = el.getAttribute(attr);
      if (v == null || v.trim() === "") continue;
      // Only localize things that look like files (have an extension or a known asset dir).
      if (attr === "href" && el.tagName?.toLowerCase() === "a" && !/\.[a-z0-9]{2,4}($|[?#])/i.test(v)) continue;
      el.setAttribute(attr, localizeAssetUrl(v));
    }
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      el.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((p) => {
            const bits = p.trim().split(/\s+/);
            bits[0] = localizeAssetUrl(bits[0] ?? "");
            return bits.join(" ");
          })
          .join(", "),
      );
    }
  }
  // url(...) in inline styles and <style> blocks.
  const fixCss = (css: string) =>
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, q: string, ref: string) => `url(${q}${localizeAssetUrl(ref)}${q})`);
  for (const el of root.querySelectorAll("[style]")) {
    const st = el.getAttribute("style") ?? "";
    if (st.includes("url(")) el.setAttribute("style", fixCss(st));
  }
  for (const st of root.querySelectorAll("style")) {
    if (st.innerHTML.includes("url(")) st.set_content(fixCss(st.innerHTML));
  }
}

/**
 * Clean a piece of WordPress markup for the output while keeping fidelity:
 * remove residual PHP/ASP, drop inline event handlers and `javascript:` links,
 * normalize local asset paths to `assets/<file>`, and KEEP `<script>` tags (the
 * theme's own JS, which the operator deliberately imported). Returns the body's
 * inner markup (chrome/head is dropped — the layout skeleton provides it).
 */
/**
 * Collapse PHP alternative-syntax conditionals (`if (…) : … elseif (…) : … else : …
 * endif;`), keeping only the FIRST branch. A static import can't evaluate the
 * condition, and stripping PHP naively leaves EVERY branch's HTML — so a theme that
 * renders a logo (or a menu, a widget) differently per `if/else` ends up emitting it
 * twice. Keeping the first branch matches what the live site shows for the common
 * default state and removes the duplicate. Nested conditionals collapse too; other
 * `<?php … ?>` blocks (the_content, wp_nav_menu, …) are left untouched for the later
 * passes. Brace-syntax `if () { } else { }` is left alone (rare in output markup).
 */
export function collapsePhpConditionals(html: string): string {
  const TOKEN = /<\?php\s+(if\b[\s\S]*?:|elseif\b[\s\S]*?:|else\s*:|endif\s*;?)\s*\?>/gi;
  type Kind = "if" | "elseif" | "else" | "endif" | "text";
  const parts: { kind: Kind; text: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(html)) !== null) {
    if (m.index > last) parts.push({ kind: "text", text: html.slice(last, m.index) });
    const kw = (m[1] ?? "").toLowerCase();
    const kind: Kind = kw.startsWith("if")
      ? "if"
      : kw.startsWith("elseif")
        ? "elseif"
        : kw.startsWith("else")
          ? "else"
          : "endif";
    parts.push({ kind, text: m[0] });
    last = m.index + m[0].length;
  }
  parts.push({ kind: "text", text: html.slice(last) });
  if (!parts.some((p) => p.kind === "if")) return html; // nothing to do

  let i = 0;
  // Read one branch (up to this level's elseif/else/endif); recurse into nested ifs
  // so their terminators are consumed and don't end this branch. `keep` controls
  // whether the content is emitted (first branch) or discarded (else branches).
  const readBranch = (keep: boolean): string => {
    let out = "";
    while (i < parts.length) {
      const p = parts[i]!;
      if (p.kind === "text") {
        if (keep) out += p.text;
        i++;
      } else if (p.kind === "if") {
        i++;
        out += readIf(keep);
      } else {
        return out; // elseif / else / endif of the current level
      }
    }
    return out;
  };
  // `if` token already consumed: keep the first branch, discard the rest, consume endif.
  const readIf = (keep: boolean): string => {
    const first = readBranch(keep);
    while (i < parts.length && parts[i]!.kind !== "endif") {
      i++; // consume elseif / else
      readBranch(false); // discard that branch
    }
    if (i < parts.length && parts[i]!.kind === "endif") i++; // consume endif
    return first;
  };
  let result = "";
  while (i < parts.length) {
    const p = parts[i]!;
    if (p.kind === "text") {
      result += p.text;
      i++;
    } else if (p.kind === "if") {
      i++;
      result += readIf(true);
    } else {
      i++; // stray elseif/else/endif (unbalanced) — drop the token
    }
  }
  return result;
}

function cleanWpMarkup(raw: string): string {
  let s = collapsePhpConditionals(raw)
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<%[\s\S]*?%>/g, "")
    .replace(/\{%[\s\S]*?%\}/g, "")
    .replace(/\{\{[\s\S]*?\}\}/g, "")
    // Gutenberg block delimiters (`<!-- wp:… -->` / `<!-- /wp:… -->`). These are
    // WordPress's block-template SYNTAX, not content, and CLAUDE.md requires template
    // syntax be removed from the output. The classic path doesn't parse them (only the
    // block path does), so a classic/mixed theme that bundles block markup — a pattern
    // PHP file, an FSE template — would leak raw `<!-- wp: -->` comments into the page.
    // Strip the delimiters, keeping the real HTML between them.
    .replace(/<!--\s*\/?wp:[\s\S]*?-->/g, "");
  // Unterminated trailing PHP: WP templates routinely end with `<?php\nget_footer();`
  // and NO closing `?>` (the PHP tag runs to EOF). Those never match the terminated
  // rules above, so strip any remaining open `<?php`/`<?=` through end-of-string.
  // In valid templates an open tag only occurs at EOF — HTML after an unclosed tag
  // would be a PHP parse error — so this cannot swallow real markup.
  s = s.replace(/<\?(?:php\b|=)[\s\S]*$/i, "").replace(/<\?php\s*$/i, "");
  // Strip the document wrapper so a partial header.php (doctype + head + <body>
  // with no </body>) never leaks its <head>/<!doctype> into a layout slot. The
  // shared chrome (charset, viewport, stylesheet) is supplied by layoutSkeleton.
  s = s
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "");
  const root = parse(s, { comment: true });
  // Drop inline event handlers / javascript: links (keep <script> elements).
  for (const el of root.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on")) el.removeAttribute(name);
      else if ((lower === "href" || lower === "src") && /^\s*javascript:/i.test(el.getAttribute(name) ?? "")) {
        el.setAttribute(name, "#");
      }
    }
  }
  normalizeWpAssets(root);
  const body = root.querySelector("body");
  return (body ? body.innerHTML : root.toString()).trim();
}

function buildLayout(
  kind: WpImportResult["kind"],
  files: WpImportFile[],
  byBase: Map<string, string>,
  externalStyles: string[] = [],
  themeMods?: ThemeModDefaults,
): string | null {
  let header = "";
  let footer = "";
  // A block theme keeps its chrome in parts/header.html + parts/footer.html; a
  // classic theme in header.php + footer.php. A mixed theme may have either, so
  // prefer the block parts when present and fall back to the PHP chrome.
  const parts = collectBlockParts(files);
  const hp = files.find((f) => /(^|\/)parts\/(header|site-header)\.html$/i.test(f.path));
  const fp = files.find((f) => /(^|\/)parts\/(footer|site-footer)\.html$/i.test(f.path));
  const useBlockChrome = (kind === "block" || kind === "mixed") && (hp != null || fp != null);
  if (useBlockChrome) {
    const ctx = (): Partial<BlockRenderCtx> => ({ parts, skipChromeParts: false, seen: new Set() });
    if (hp) header = cleanWpMarkup(gutenbergToHtml(parseGutenberg(hp.text), ctx()));
    if (fp) footer = cleanWpMarkup(gutenbergToHtml(parseGutenberg(fp.text), ctx()));
  } else {
    const php = byBase.get("header.php");
    const pfp = byBase.get("footer.php");
    if (php) header = cleanWpMarkup(mapTemplateTags(php, themeMods).html);
    if (pfp) footer = cleanWpMarkup(mapTemplateTags(pfp, themeMods).html);
  }
  if (!header && !footer) return null;
  // Load only the scripts the theme enqueues that aren't already linked inline
  // by the header/footer (those survive cleanWpMarkup and load as-is).
  const alreadyInline = inlineScriptBases(`${header}\n${footer}`);
  const scriptTags = collectEnqueuedScripts(files)
    .filter((s) => s.external || !alreadyInline.has(s.base))
    .map((s) => `    <script src="${s.url}" defer></script>`)
    .join("\n");
  const styleTags = externalStyles
    .map((url) => `    <link rel="stylesheet" href="${url}" />`)
    .join("\n");
  return layoutSkeleton(header, footer, "ja", scriptTags, styleTags);
}

const ASSET_URL = /(?:src|href)\s*=\s*"([^"]+)"|url\(\s*(['"]?)([^'")]+)\2\s*\)/gi;

/** Base names of local image assets referenced in the produced HTML. */
function collectAssetBasenames(html: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  ASSET_URL.lastIndex = 0;
  while ((m = ASSET_URL.exec(html)) !== null) {
    const url = m[1] ?? m[3] ?? "";
    if (url === "" || url.startsWith("#") || /^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) continue;
    if (!/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(url)) continue;
    const base = baseName(url);
    if (base) out.add(base);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Template-hierarchy mapping + orchestrator
// ---------------------------------------------------------------------------

/**
 * PHP stems that are part of the WordPress template hierarchy or theme plumbing —
 * never a custom 固定ページ template. (`home` carries a `Template Name:` in some _s
 * themes but is the blog index here; index.php is the real home, so it is reserved.)
 */
const RESERVED_PHP_STEMS = new Set([
  "index", "front-page", "home", "single", "singular", "page", "archive", "category",
  "tag", "taxonomy", "author", "search", "404", "header", "footer", "sidebar",
  "functions", "comments", "searchform", "attachment", "embed", "date", "image",
]);

/** The `Template Name:` from a page template's leading doc-comment, if any. */
function templateNameOf(php: string): string | undefined {
  const m = /Template Name\s*:\s*(.+)/i.exec(php.slice(0, 2000));
  if (!m) return undefined;
  const name = (m[1] ?? "").replace(/\*\/.*$/, "").trim();
  return name || undefined;
}

/**
 * Titles for a block theme's custom page templates, from `theme.json`'s
 * `customTemplates` (`[{ name:"page-wide", title:"幅広", postTypes:["page"] }]`).
 * Keyed by template name (= the `templates/<name>.html` stem). Lets an imported
 * 固定ページ carry the theme's own label instead of a title-cased slug.
 */
function parseCustomTemplateTitles(themeJsonText: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!themeJsonText) return out;
  try {
    const data = JSON.parse(themeJsonText) as { customTemplates?: { name?: string; title?: string }[] };
    for (const t of data.customTemplates ?? []) {
      if (typeof t.name === "string" && typeof t.title === "string" && t.title.trim()) {
        out.set(t.name.toLowerCase(), t.title.trim());
      }
    }
  } catch {
    /* ignore malformed theme.json */
  }
  return out;
}

/** "page-service" / "about_us" → "Page Service" / "About Us" (title fallback). */
function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Human labels for the top-page candidate templates, shown in the wizard. */
const HOME_LABELS: Record<string, string> = {
  "front-page": "トップページ専用（front-page）",
  home: "ブログのトップ（home）",
  index: "一覧（index）",
};
/** Home-candidate stems, in the order WordPress itself prefers them. */
const HOME_STEMS = ["front-page", "home", "index"] as const;

/**
 * Detect content the theme renders dynamically, which a theme ZIP doesn't carry
 * (it lives in the WordPress database): Customizer theme-mods, a custom logo,
 * widgets, and post loops. The wizard shows these so the operator knows the hero
 * text / logo / news list will be empty until they fill them in. Returns ready-to
 * -show Japanese labels, deduped.
 */
function detectUnresolvedContent(files: WpImportFile[]): string[] {
  const text = files
    .filter((f) => /\.(php|html?)$/i.test(f.path))
    .map((f) => f.text)
    .join("\n");
  const out: string[] = [];
  if (/get_theme_mod\s*\(|[a-z0-9_]*_mod\s*\(\s*['"]/i.test(text)) {
    out.push("カスタマイザー（外観＞カスタマイズ）の設定値：ヒーローの文言・色など");
  }
  if (/the_custom_logo\s*\(|get_custom_logo\s*\(|[a-z0-9_]*_logo\s*\(/i.test(text)) {
    out.push("ロゴ画像");
  }
  if (/dynamic_sidebar\s*\(|is_active_sidebar\s*\(/i.test(text)) {
    out.push("ウィジェット（サイドバー・フッター）");
  }
  if (/have_posts\s*\(\s*\)/i.test(text) || /wp:query\b/i.test(text)) {
    out.push("記事・お知らせの一覧（記事データ）");
  }
  return [...new Set(out)];
}

/** WordPress template file stem → pcms template name. */
function pcmsTemplateName(stem: string): string | null {
  if (["index", "front-page", "home"].includes(stem)) return "index";
  if (["single", "singular"].includes(stem)) return "post";
  if (["page"].includes(stem)) return "page";
  if (["archive", "category", "tag", "taxonomy", "search", "author"].includes(stem)) return "archive";
  return null;
}

/** Collect block-theme templates (templates/*.html) keyed by pcms name. */
function collectBlockTemplates(files: WpImportFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    if (!/(^|\/)templates\/[^/]+\.html$/i.test(f.path.replace(/\\/g, "/"))) continue;
    const name = pcmsTemplateName(stemOf(f.path));
    if (name && !out.has(name)) out.set(name, f.text);
  }
  return out;
}

/**
 * Compose a classic template's BODY: the page-specific middle only. The theme's
 * chrome (get_header/get_footer) is dropped — it lives in layout.html — while
 * content includes (get_template_part/get_sidebar) are inlined. Recursion-guarded.
 */
function composeTemplateBody(stem: string, files: Map<string, string>): string {
  const seen = new Set<string>();
  const expand = (html: string): string => {
    const s = html.replace(phpCall("get_header"), "").replace(phpCall("get_footer"), "");
    return inlineParts(s, files, seen, expand);
  };
  return expand(files.get(`${stem}.php`) ?? "");
}

/** Collect classic templates (php hierarchy) keyed by pcms name, body only. */
function collectClassicTemplates(files: WpImportFile[]): Map<string, string> {
  const php = new Map<string, string>();
  for (const f of files) {
    if (/\.php$/i.test(f.path)) php.set(baseName(f.path).toLowerCase(), f.text);
  }
  const out = new Map<string, string>();
  const order = ["front-page", "home", "index", "single", "singular", "page", "archive", "category", "search"];
  for (const stem of order) {
    if (!php.has(`${stem}.php`)) continue;
    const name = pcmsTemplateName(stem);
    if (!name || out.has(name)) continue;
    out.set(name, composeTemplateBody(stem, php));
  }
  return out;
}

/**
 * Turn a piece of mapped template markup into a finished pcms template: clean it
 * (keep scripts, normalize assets), split it into editable `data-section`s whose
 * headings/paragraphs/images become `data-field`s, name the sections, and add a
 * block slot to each. This is what makes imported parts individually editable.
 */
function toTemplateHtml(markup: string): { html: string; issues: AiIssue[] } {
  const body = cleanWpMarkup(markup);
  const themed = themeifyHtml(body);
  const relabelled = relabelSections(themed).html;
  const withBlocks = addBlockSlots(relabelled).html;
  return { html: withBlocks, issues: validateThemeHtml(withBlocks) };
}

/**
 * A generic single-entry template (title + body slot). Used when a classic
 * `page.php` / `single.php` composes to nothing — its content lives in a
 * template-part that wasn't in the archive, or in a loop that produced no
 * markup — so the operator still gets a page that renders its content instead of
 * a blank template. Mirrors what `the_title` + `the_content` map to.
 */
const GENERIC_ENTRY =
  '<article class="entry">\n' +
  '  <h1 data-field="post.title" data-type="text" data-label="タイトル"></h1>\n' +
  '  <div data-slot="content" data-field="post.body" data-type="richtext" data-label="本文"></div>\n' +
  "</article>";

/** True when a produced template has no editable field, slot, loop or text. */
function isEmptyTemplate(html: string): boolean {
  if (/data-(?:field|slot|loop|repeat)\b/i.test(html)) return false;
  return html.replace(/<[^>]+>/g, "").trim() === "";
}

/** The editable body slot a post/page template must carry. */
const CONTENT_SLOT =
  '<div data-slot="content" data-field="post.body" data-type="richtext" data-label="本文"></div>';

/**
 * Guarantee a post/page template has an editable body slot. Some themes build the
 * content wrapper in a part but leave `the_content()` out of it (the branberyheag
 * `content.php` ships an empty `<div class="richtext">`), so the composed template
 * has real structure yet no `data-slot="content"` — the body would be uneditable.
 * Inject the slot into the first empty content-ish container (richtext /
 * entry-content / post-content), else append it to the main section, so the post
 * body is always editable without discarding the theme's own markup.
 */
function ensureContentSlot(html: string): { html: string; added: boolean } {
  if (/data-slot\s*=\s*["']content["']/i.test(html)) return { html, added: false };
  const root = parse(html);
  for (const el of root.querySelectorAll("div,section,article,main")) {
    const cls = el.getAttribute("class") ?? "";
    if (/\b(richtext|entry-content|post-content|the-content|post_content)\b/i.test(cls) && el.innerHTML.trim() === "") {
      el.set_content(CONTENT_SLOT);
      return { html: root.toString(), added: true };
    }
  }
  const host = root.querySelector("[data-section]") ?? root;
  host.set_content(host.innerHTML + CONTENT_SLOT);
  return { html: root.toString(), added: true };
}

/** Dedupe notes while keeping order. */
function dedupe(notes: string[]): string[] {
  return [...new Set(notes)];
}

/**
 * Import a whole WordPress theme (unzipped text entries) into a pcms theme.
 * Routes to the classic or block pipeline, composes a layout from the theme's
 * header/footer, maps the template hierarchy, and validates every produced
 * template. Unknown archives fall back to the generic per-file importer by
 * treating each markup file as a section (the caller handles that path).
 */
export function importWpTheme(files: WpImportFile[]): WpImportResult {
  const kind = detectWpThemeKind(files);
  // A block theme's Gutenberg templates — and a mixed theme's — go through the
  // block pipeline (parse `<!-- wp: -->` → editable fields), not the classic PHP
  // one. Routing this correctly is what stops block markup from being flattened
  // by the classic strip (the old "mixed falls to classic" bug).
  const useBlockPipeline = kind === "block" || kind === "mixed";
  const blockParts = collectBlockParts(files);
  const blockCtx = (): Partial<BlockRenderCtx> => ({
    parts: blockParts,
    skipChromeParts: true, // the layout owns header/footer; a body must not repeat them
    seen: new Set<string>(),
  });
  const notes: string[] = [];
  const byBase = new Map(files.map((f) => [baseName(f.path).toLowerCase(), f.text]));
  const out: WpThemeFiles = { templates: {}, sections: {}, blocks: {}, assets: [], styles: [] };
  // Theme-mod defaults (classic only): pre-fill editable fields with the text the
  // theme itself ships, so the top page imports populated rather than blank.
  const themeMods = useBlockPipeline
    ? { wrappers: new Set<string>(), values: new Map<string, string>() }
    : collectThemeModDefaults(files);

  // theme.json tokens.
  const themeJson = files.find((f) => /(^|\/)theme\.json$/i.test(f.path.replace(/\\/g, "/")));
  if (themeJson) {
    const { config, notes: n } = wpThemeJsonToKumito(themeJson.text);
    out["theme.json"] = JSON.stringify(config, null, 2);
    notes.push(...n);
  } else {
    const css = byBase.get("style.css");
    const name = css ? parseStyleCssName(css) : undefined;
    if (name) {
      out["theme.json"] = JSON.stringify({ name }, null, 2);
      notes.push(`テーマ名「${name}」を読み取りました。`);
    }
  }

  // Templates. Each is cleaned (scripts kept, asset paths normalized) and split
  // into editable sections (headings/paragraphs/images → data-field).
  const sources = useBlockPipeline ? collectBlockTemplates(files) : collectClassicTemplates(files);
  const issues: AiIssue[] = [];
  let filledFromDefaults = false;
  for (const [name, rawHtml] of sources) {
    let mapped: string;
    if (useBlockPipeline) {
      mapped = gutenbergToHtml(parseGutenberg(rawHtml), blockCtx());
    } else {
      const mt = mapTemplateTags(rawHtml, themeMods);
      mapped = mt.html;
      if (mt.notes.some((n) => n.includes("初期値"))) filledFromDefaults = true;
    }
    let r = toTemplateHtml(mapped);
    // A single-entry template (page/post) that composed to nothing — content in
    // an absent template-part, or a loop that yielded no markup — would render a
    // blank page. Fall back to the generic title+body template so it shows the
    // post's content. (index/archive legitimately render via data-loop.)
    if ((name === "page" || name === "post") && isEmptyTemplate(r.html)) {
      r = toTemplateHtml(GENERIC_ENTRY);
      notes.push(`${name}テンプレートの本文を抽出できず、汎用テンプレート（タイトル＋本文）で補いました。`);
    } else if (name === "page" || name === "post") {
      const slot = ensureContentSlot(r.html);
      if (slot.added) {
        r = { html: slot.html, issues: validateThemeHtml(slot.html) };
        notes.push(`${name}テンプレートに本文の編集欄（本文スロット）を補いました。`);
      }
    }
    out.templates[name] = r.html;
    issues.push(...r.issues);
  }
  if (filledFromDefaults) {
    notes.push("テーマの初期値（カスタマイザー）を各編集欄に取り込みました。");
  }
  // Ensure a page and a post template always exist, even if the theme shipped
  // none (or only an index) — otherwise non-home content has nothing to render.
  for (const name of ["page", "post"] as const) {
    if (!out.templates[name] || isEmptyTemplate(out.templates[name]!)) {
      const r = toTemplateHtml(GENERIC_ENTRY);
      out.templates[name] = r.html;
      issues.push(...r.issues);
    }
  }

  // Custom page templates — the designed 固定ページ (Service / About / Project …).
  // Each becomes its own template plus a page entry in the theme preset, so the
  // generated site ships /<slug>/ with its real design, individually editable.
  //  • A classic theme ships one PHP file per such page: `page-<slug>.php` (WP's
  //    slug-specific page template) or any file carrying a `Template Name:` header.
  //  • A block theme ships `templates/page-<slug>.html` (the FSE equivalent), with
  //    a human title in theme.json `customTemplates`.
  // Without this they collapse into the generic `page` template and lose their
  // bespoke layout.
  const pageDescriptors: { id: string; template: string; title?: string }[] = [];
  const seenSlug = new Set<string>();
  if (useBlockPipeline) {
    const titles = parseCustomTemplateTitles(themeJson?.text);
    for (const f of files) {
      const m = /(^|\/)templates\/(page-[^/]+)\.html$/i.exec(f.path.replace(/\\/g, "/"));
      if (!m) continue;
      const stem = (m[2] ?? "").toLowerCase(); // e.g. "page-about"
      const slug = stem.replace(/^page-/, "");
      if (!slug || seenSlug.has(slug) || out.templates[stem]) continue;
      seenSlug.add(slug);
      const mapped = gutenbergToHtml(parseGutenberg(f.text), blockCtx());
      let r = toTemplateHtml(mapped);
      if (isEmptyTemplate(r.html)) r = toTemplateHtml(GENERIC_ENTRY);
      out.templates[stem] = r.html;
      issues.push(...r.issues);
      pageDescriptors.push({ id: slug, template: stem, title: titles.get(stem) ?? titleCase(slug) });
    }
  } else {
    const php = new Map<string, string>();
    for (const f of files) {
      if (/\.php$/i.test(f.path)) php.set(baseName(f.path).toLowerCase(), f.text);
    }
    for (const [file, text] of php) {
      const stem = file.replace(/\.php$/i, "");
      if (RESERVED_PHP_STEMS.has(stem)) continue;
      const isPagePrefixed = /^page-.+/.test(stem);
      const tname = templateNameOf(text);
      if (!isPagePrefixed && !tname) continue;
      const slug = isPagePrefixed ? stem.replace(/^page-/, "") : stem;
      if (!slug || seenSlug.has(slug) || out.templates[stem]) continue;
      seenSlug.add(slug);
      const mapped = mapTemplateTags(composeTemplateBody(stem, php), themeMods).html;
      let r = toTemplateHtml(mapped);
      if (isEmptyTemplate(r.html)) r = toTemplateHtml(GENERIC_ENTRY);
      out.templates[stem] = r.html;
      issues.push(...r.issues);
      pageDescriptors.push({ id: slug, template: stem, title: tname ?? titleCase(slug) });
    }
  }
  if (pageDescriptors.length > 0) {
    notes.push(`固定ページ（${pageDescriptors.length}件）をそれぞれのデザインで取り込みました。`);
  }

  // The theme's default page composition (presets/pages.json): the home page plus
  // each imported 固定ページ, each naming its own template. presetSettingsFor applies
  // this when the theme becomes active; content (posts/pages/media) is untouched.
  {
    const pages: Record<string, { template: string; title?: string }> = {
      index: { template: "index" },
    };
    for (const d of pageDescriptors) {
      pages[d.id] = d.title ? { template: d.template, title: d.title } : { template: d.template };
    }
    out.preset = JSON.stringify({ pages, regions: {} }, null, 2);
  }

  // The CSS the theme actually loads (in load order) — the single biggest
  // fidelity lever. Only this CSS is folded into assets/style.css; the rest of the
  // archive's stylesheets (vendor libs, a library's docs CSS, the RTL mirror) are
  // left out so they can't override the real design. External (CDN) stylesheets
  // are linked from the layout head instead.
  const styleRefs = collectEnqueuedStyles(files);
  out.styles = styleRefs.filter((s) => !s.external).map((s) => s.base);
  const externalStyles = styleRefs.filter((s) => s.external).map((s) => s.url);
  if (out.styles.length > 0) {
    notes.push(`テーマが読み込むCSS（${out.styles.length}件）だけを使い、未使用のCSSは除外しました。`);
  }

  // Layout from header/footer.
  const layout = buildLayout(kind, files, byBase, externalStyles, themeMods);
  if (layout) {
    out["layout.html"] = layout;
    notes.push("ヘッダー・フッターから共通レイアウト（layout.html）を作成しました。");
  }

  out.assets = collectAssetBasenames(
    Object.values(out.templates).join("\n") + (out["layout.html"] ?? ""),
  );

  const cssCount = files.filter((f) => /\.css$/i.test(f.path)).length;
  if (cssCount > 0) notes.push(`${cssCount}個のCSSを assets/ に取り込みます（見た目を維持）。`);

  if (Object.keys(out.templates).length === 0) {
    notes.push("テンプレートを抽出できませんでした（WordPressテーマとして認識されなかった可能性）。");
  }

  // Wizard data: the operator confirms the import's shape before it becomes a
  // theme. Top-page candidates (a theme can ship front-page / home / index), each
  // composed through the same pipeline so the UI can swap templates/index.html to
  // the chosen one; the importable 固定ページ; and the dynamic content the ZIP
  // can't carry (so the operator knows to fill it in).
  const phpMap = new Map<string, string>();
  for (const f of files) {
    if (/\.php$/i.test(f.path)) phpMap.set(baseName(f.path).toLowerCase(), f.text);
  }
  const composeHomeHtml = (stem: string): string | undefined => {
    if (useBlockPipeline) {
      const f = files.find((x) =>
        new RegExp(`(^|/)templates/${stem}\\.html$`, "i").test(x.path.replace(/\\/g, "/")),
      );
      return f ? toTemplateHtml(gutenbergToHtml(parseGutenberg(f.text), blockCtx())).html : undefined;
    }
    if (!phpMap.has(`${stem}.php`)) return undefined;
    return toTemplateHtml(mapTemplateTags(composeTemplateBody(stem, phpMap), themeMods).html).html;
  };
  const homeCandidates: { stem: string; label: string; html: string }[] = [];
  for (const stem of HOME_STEMS) {
    const html = composeHomeHtml(stem);
    if (html && !isEmptyTemplate(html)) {
      homeCandidates.push({ stem, label: HOME_LABELS[stem] ?? stem, html });
    }
  }
  if (homeCandidates.length === 0 && out.templates.index) {
    homeCandidates.push({ stem: "index", label: HOME_LABELS.index!, html: out.templates.index });
  }
  const wizard: WpImportWizard = {
    home: { chosen: homeCandidates[0]?.stem ?? "index", candidates: homeCandidates },
    pages: pageDescriptors.map((d) => ({ id: d.id, template: d.template, title: d.title ?? titleCase(d.id) })),
    unresolved: detectUnresolvedContent(files),
  };

  return { kind, files: out, issues, notes: dedupe(notes), wizard };
}
