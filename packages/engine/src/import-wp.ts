import { parse } from "node-html-parser";
import type { ThemeConfig } from "@pcms/shared";
import { type AiIssue } from "./ai.js";
import { cleanImportedHtml, importThemeHtml } from "./import.js";

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
}

export interface WpImportResult {
  kind: "classic" | "block" | "mixed" | "unknown";
  files: WpThemeFiles;
  issues: AiIssue[];
  notes: string[];
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

/**
 * Classify a WordPress theme archive: a block theme ships `theme.json` plus
 * `templates/*.html` (and usually `parts/*.html`); a classic theme ships PHP
 * template files (index.php/style.css with a theme header). Both present = mixed.
 */
export function detectWpThemeKind(files: WpImportFile[]): WpImportResult["kind"] {
  // Block themes are defined by theme.json + templates/*.html (they also ship a
  // style.css header, so that header alone is not a classic signal).
  const block =
    hasFile(files, /(^|\/)theme\.json$/i) &&
    hasFile(files, /(^|\/)templates\/[^/]+\.html$/i);
  // Classic themes are defined by their PHP template files.
  const classic =
    hasFile(files, /(^|\/)index\.php$/i) ||
    hasFile(files, /(^|\/)(single|page|archive|header|footer|front-page|home)\.php$/i);
  if (block && classic) return "mixed";
  if (block) return "block";
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
 * Render a Gutenberg block tree to pcms-annotated HTML. Core text/media blocks
 * become editable `data-field` elements; container blocks (group/columns) keep
 * their structure and recurse; unknown blocks keep their saved HTML verbatim
 * (fidelity over cleverness). A later `importThemeHtml` pass wraps the result in
 * `data-section`s and adds block slots.
 */
export function gutenbergToHtml(blocks: WpBlock[]): string {
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
      case "core/post-featured-image":
        return annotate(blk.innerHtml || '<img src="" alt="" />', "img", field("image"), "image", "画像");
      case "core/button": {
        const html = blk.innerHtml || '<a class="btn" href="#"></a>';
        const withLink = annotate(html, "a", field("link"), "link", "ボタンのリンク");
        return annotate(withLink, "a", field("link"), "link", "ボタンのリンク");
      }
      case "core/post-title":
        return `<h1 data-field="post.title" data-type="text" data-label="タイトル"></h1>`;
      case "core/post-content":
        return `<div data-slot="content" data-field="post.body" data-type="richtext" data-label="本文"></div>`;
      case "core/post-date":
        return `<p data-field="post.date" data-type="text" data-label="日付"></p>`;
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
      case "core/template-part":
      case "core/site-title":
      case "core/site-logo":
      case "core/navigation":
        // Chrome blocks — handled by the layout; render minimally.
        return inner;
      default:
        // Unknown block: keep its saved HTML so appearance is preserved.
        return blk.innerHtml + inner;
    }
  };
  return blocks.map(render).join("\n");
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

const TAG_RULES: TagRule[] = [
  { re: phpCall("the_title|get_the_title"), repl: '<span data-field="post.title" data-type="text" data-label="タイトル"></span>' },
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
 * Convert the common WordPress template tags into pcms `data-field` bindings
 * before the PHP is stripped — this is the fidelity core for classic themes.
 * Permalinks collapse to `#`, asset-path helpers collapse to a relative path
 * (so `normalizeAssets` can fold them into `assets/`), menus become a dynamic
 * `data-loop="menu"`. Anything left is removed by `cleanImportedHtml` later, so
 * no PHP reaches the output.
 */
export function mapTemplateTags(html: string): { html: string; notes: string[] } {
  const notes: string[] = [];
  let s = html;
  const apply = (re: RegExp, repl: string, note: string): void => {
    if (re.test(s)) {
      s = s.replace(re, repl);
      notes.push(note);
    }
    re.lastIndex = 0;
  };

  // Asset path helpers inside a URL: drop the PHP, keep the trailing path.
  s = s.replace(
    /<\?php\s+(?:echo\s+)?(?:get_template_directory_uri|get_stylesheet_directory_uri|get_theme_file_uri|get_stylesheet_uri)\s*\([\s\S]*?\)\s*;?\s*\?>/gi,
    "",
  );
  // Permalinks (often inside href="…").
  s = s.replace(phpCall("the_permalink|get_permalink|get_the_permalink"), "#");

  // wp_nav_menu(...) → a single dynamic menu item.
  if (/wp_nav_menu/i.test(s)) {
    s = s.replace(
      phpCall("wp_nav_menu"),
      '<nav><a data-loop="menu" data-field="item.url" data-type="link" href="#"><span data-field="item.label" data-type="text" data-label="ラベル">メニュー</span></a></nav>',
    );
    notes.push("メニュー（wp_nav_menu）を動的メニューに変換しました。");
  }

  for (const rule of TAG_RULES) apply(rule.re, rule.repl, `WordPressのテンプレートタグを編集項目に変換しました。`);
  for (const re of TAG_REMOVE) s = s.replace(re, "");

  // De-duplicate the generic conversion note.
  const uniq = [...new Set(notes)];
  return { html: s, notes: uniq };
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
    s = s.replace(
      /<\?php\s+(?:get_template_part|get_sidebar)\s*\(\s*(['"])([^'"]+)\1(?:\s*,\s*(['"])([^'"]+)\3)?[\s\S]*?\)\s*;?\s*\?>/gi,
      (_m, _q1: string, slug: string, _q3: string, part?: string) => {
        const candidates = [part ? `${slug}-${part}` : "", slug, `sidebar`].filter(Boolean);
        for (const c of candidates) {
          const found = files.get(`${c}.php`) ?? files.get(baseName(c) + ".php");
          if (found) return expand(found);
        }
        return "";
      },
    );
    return s;
  };
  const start = files.get(`${stem}.php`) ?? "";
  return expand(start);
}

// ---------------------------------------------------------------------------
// Layout composition + asset collection
// ---------------------------------------------------------------------------

/** The pcms layout.html skeleton (same shape as the sample theme). */
function layoutSkeleton(headerMarkup: string, footerMarkup: string, lang: string): string {
  return (
    `<!doctype html>\n<html lang="${lang}">\n  <head>\n` +
    `    <meta charset="utf-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `    <title data-field="site.name"></title>\n` +
    `    <link rel="stylesheet" href="/assets/style.css" />\n` +
    `  </head>\n  <body>\n` +
    `    <div data-slot="header">${headerMarkup}</div>\n\n` +
    `    <main data-slot="content"></main>\n\n` +
    `    <div data-slot="footer">${footerMarkup}</div>\n` +
    `  </body>\n</html>\n`
  );
}

/** The body markup of a header/footer partial, cleaned of PHP/scripts. */
function partialMarkup(raw: string): string {
  const { html } = cleanImportedHtml(mapTemplateTags(raw).html);
  // cleanImportedHtml may re-add a <style> block; keep only element markup for
  // the header/footer region (shared CSS lives in assets/style.css).
  return html.replace(/<style>[\s\S]*?<\/style>\s*/i, "").trim();
}

function buildLayout(kind: WpImportResult["kind"], files: WpImportFile[], byBase: Map<string, string>): string | null {
  let header = "";
  let footer = "";
  if (kind === "block") {
    const hp = files.find((f) => /(^|\/)parts\/(header|site-header)\.html$/i.test(f.path));
    const fp = files.find((f) => /(^|\/)parts\/(footer|site-footer)\.html$/i.test(f.path));
    if (hp) header = gutenbergToHtml(parseGutenberg(hp.text));
    if (fp) footer = gutenbergToHtml(parseGutenberg(fp.text));
  } else {
    const hp = byBase.get("header.php");
    const fp = byBase.get("footer.php");
    if (hp) header = partialMarkup(hp);
    if (fp) footer = partialMarkup(fp);
  }
  if (!header && !footer) return null;
  return layoutSkeleton(header, footer, "ja");
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

/** Collect classic templates (php hierarchy) keyed by pcms name, includes inlined. */
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
    out.set(name, composeClassicTemplate(stem, php));
  }
  return out;
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
  const notes: string[] = [];
  const byBase = new Map(files.map((f) => [baseName(f.path).toLowerCase(), f.text]));
  const out: WpThemeFiles = { templates: {}, sections: {}, blocks: {}, assets: [] };

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

  // Templates.
  const sources = kind === "block" ? collectBlockTemplates(files) : collectClassicTemplates(files);
  const issues: AiIssue[] = [];
  for (const [name, rawHtml] of sources) {
    const pre = kind === "block" ? gutenbergToHtml(parseGutenberg(rawHtml)) : mapTemplateTags(rawHtml).html;
    const r = importThemeHtml(pre);
    out.templates[name] = r.html;
    issues.push(...r.issues);
    notes.push(...r.notes);
  }

  // Layout from header/footer.
  const layout = buildLayout(kind, files, byBase);
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

  return { kind, files: out, issues, notes: dedupe(notes) };
}
