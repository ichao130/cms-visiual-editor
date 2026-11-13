import { parse, type HTMLElement, type Node } from "node-html-parser";
import type { InlineFieldType } from "@pcms/shared";
import { themeifyHtml, validateThemeHtml, type AiIssue } from "./ai.js";

/**
 * Theme import — turn an external theme/template (WordPress, Shopify, a plain
 * HTML page, anything) into a pcms theme fragment. It strips the platform- and
 * server-specific bits (PHP, template directives, scripts), keeps <style>,
 * extracts the page body, detects repeating lists (so they become increment-
 * able items), then runs the themeify annotator. Pure: string in, result out,
 * no I/O. CLAUDE.md: PHP は出力に出さない / AIの出力は検証してから使う.
 */

/** A hint about where the markup came from, used only for the notes/log. */
export type ImportSource = "auto" | "wordpress" | "shopify" | "figma" | "html" | "other";

export interface ImportResult {
  /** The cleaned, themeified HTML — a pcms theme fragment. When a shared layout
   *  was split off (see `layout`), this is the inner content only. */
  html: string;
  /** Validation issues on the result (same check as any AI-proposed theme). */
  issues: AiIssue[];
  /** Human-readable notes on what the optimizer removed or changed. */
  notes: string[];
  /** When the markup had header+footer chrome, a layout.html candidate
   *  (`<header>…</header><div data-slot="content"></div><footer>…</footer>`);
   *  `html` is then just the content that goes into the slot. */
  layout?: string;
}

function isEl(n: Node): n is HTMLElement {
  return (n as HTMLElement).tagName != null;
}
function tagOf(el: HTMLElement): string {
  return el.tagName?.toLowerCase() ?? "";
}
function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter(isEl);
}

const FIELD_TAGS = "h1,h2,h3,h4,h5,h6,p,img,a";
function fieldType(t: string): InlineFieldType {
  return t === "img" ? "image" : t === "a" ? "link" : "text";
}
function labelFor(t: string): string {
  if (/^h[1-6]$/.test(t)) return "見出し";
  if (t === "img") return "画像";
  if (t === "a") return "リンク";
  return "本文";
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Strip server/template code and scripts from raw markup, keep <style>, and
 * extract the page body. Returns the cleaned HTML plus a log of what was done.
 */
export function cleanImportedHtml(raw: string): { html: string; notes: string[] } {
  const notes: string[] = [];
  let s = raw;

  const strip = (re: RegExp, repl: string, note: string): void => {
    const n = (s.match(re) ?? []).length;
    if (n > 0) {
      s = s.replace(re, repl);
      notes.push(note);
    }
  };

  // Server code and template engines — WordPress/PHP, ASP/JSP/ERB, and the
  // Liquid/Twig/Handlebars family. Block tags ({% %}) are dropped but their
  // inner HTML is kept (a loop body becomes reusable structure); expressions
  // ({{ }}) are dropped so the element is left empty for a real field.
  strip(/<\?[\s\S]*?\?>/g, "", "PHPコードを除去しました。");
  strip(/<%[\s\S]*?%>/g, "", "サーバーテンプレート（<% %>）を除去しました。");
  strip(/\{%[\s\S]*?%\}/g, "", "テンプレートのブロック記法（{% %}）を除去しました。");
  strip(/\{\{[\s\S]*?\}\}/g, "", "テンプレートの変数（{{ }}）を除去しました。");
  strip(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "", "スクリプトを除去しました。");
  strip(/<!--[\s\S]*?-->/g, "", "コメントを除去しました。");

  const root = parse(s, { comment: false });

  // Keep <style> (so the imported part stays styled); lift it out of <head> and
  // re-add it above the extracted body.
  const styleEls = root.querySelectorAll("style");
  const css = styleEls.map((st) => st.innerHTML).join("\n").trim();
  styleEls.forEach((st) => st.remove());

  const body = root.querySelector("body");
  const scope = body ?? root;

  // Remove inline event handlers and javascript: links.
  let unsafeAttrs = 0;
  for (const el of scope.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on")) {
        el.removeAttribute(name);
        unsafeAttrs += 1;
      } else if (
        (lower === "href" || lower === "src") &&
        /^\s*javascript:/i.test(el.getAttribute(name) ?? "")
      ) {
        el.setAttribute(name, "#");
        unsafeAttrs += 1;
      }
    }
  }
  if (unsafeAttrs > 0) notes.push("イベント属性や危険なリンクを除去しました。");
  if (body) notes.push("ページの<head>を除いて本文を抽出しました。");

  let html = (body ? body.innerHTML : scope.toString()).trim();
  if (css) {
    html = `<style>\n${css}\n</style>\n${html}`;
    notes.push("スタイル（<style>）を取り込みました。");
  }
  return { html, notes };
}

/** Whether these siblings look like a repeating list (cards, products, …). */
function isRepeatGroup(kids: HTMLElement[]): boolean {
  if (kids.length < 3) return false;
  const first = kids[0];
  if (!first) return false;
  const tag = tagOf(first);
  const cls = (first.getAttribute("class") ?? "").trim();
  return kids.every(
    (k) =>
      tagOf(k) === tag &&
      (k.getAttribute("class") ?? "").trim() === cls &&
      elementChildren(k).length >= 1,
  );
}

/** Collapse a repeat group to one representative item with bare-name fields. */
function collapseRepeat(kids: HTMLElement[], n: number): void {
  const keep = kids[0];
  if (!keep) return;
  for (let i = 1; i < kids.length; i++) kids[i]?.remove();
  keep.setAttribute("data-repeat", n === 1 ? "items" : `items${n}`);
  keep.setAttribute("data-label", `項目${n}`);
  let f = 0;
  for (const el of keep.querySelectorAll(FIELD_TAGS)) {
    if (el.getAttribute("data-field") != null) continue;
    f += 1;
    const t = tagOf(el);
    el.setAttribute("data-field", `f${f}`);
    el.setAttribute("data-type", fieldType(t));
    el.setAttribute("data-label", labelFor(t));
  }
}

/**
 * Find repeating lists and turn each into a single increment-able item. Scoped
 * so it never collapses the page's distinct top-level sections: it inspects the
 * children of each element, and once a group is collapsed it does not recurse
 * into it.
 */
function markRepeats(root: HTMLElement): number {
  let count = 0;
  const visit = (el: HTMLElement): void => {
    const kids = elementChildren(el);
    if (isRepeatGroup(kids)) {
      collapseRepeat(kids, ++count);
      return;
    }
    for (const k of kids) visit(k);
  };
  // Start one level in, so a group of distinct top-level sections is never
  // treated as a repeat (their children are inspected, not the sections).
  for (const c of elementChildren(root)) visit(c);
  return count;
}

/** Turn one anchor into a dynamic menu item (`data-loop="menu"`). */
function markMenuAnchor(a: HTMLElement): void {
  const label = a.text.trim() || "メニュー";
  a.setAttribute("data-loop", "menu");
  a.setAttribute("data-field", "item.url");
  a.setAttribute("data-type", "link");
  a.set_content(
    `<span data-field="item.label" data-type="text" data-label="ラベル">${escapeText(label)}</span>`,
  );
}

/**
 * Detect navigation menus: a <nav> with a list of links becomes a single
 * `data-loop="menu"` item bound to the site's menu, instead of a frozen set of
 * links. Mirrors the sample theme's layout.html convention.
 */
function detectMenus(root: HTMLElement): number {
  let count = 0;
  for (const nav of root.querySelectorAll("nav")) {
    // A <ul>/<ol> of links: keep one <li>, make its anchor the menu item.
    const listInNav = nav.querySelectorAll("ul,ol")[0];
    if (listInNav) {
      const lis = listInNav.querySelectorAll("li").filter((li) => li.querySelector("a"));
      if (lis.length >= 2) {
        const keep = lis[0];
        const a = keep?.querySelector("a");
        if (a) {
          markMenuAnchor(a);
          for (let i = 1; i < lis.length; i++) lis[i]?.remove();
          count += 1;
          continue;
        }
      }
    }
    // Otherwise direct anchors in the nav.
    const anchors = elementChildren(nav).filter((e) => tagOf(e) === "a");
    if (anchors.length >= 2 && anchors[0]) {
      markMenuAnchor(anchors[0]);
      for (let i = 1; i < anchors.length; i++) anchors[i]?.remove();
      count += 1;
    }
  }
  return count;
}

/**
 * Light performance/accessibility optimization on imported markup: lazy-load
 * images, give them an alt so they pass the pre-publish check, and harden
 * target="_blank" links with rel="noopener".
 */
function optimizeMedia(root: HTMLElement): { imgs: number; links: number } {
  let imgs = 0;
  let links = 0;
  for (const img of root.querySelectorAll("img")) {
    let changed = false;
    if (img.getAttribute("loading") == null) {
      img.setAttribute("loading", "lazy");
      changed = true;
    }
    if (img.getAttribute("decoding") == null) {
      img.setAttribute("decoding", "async");
      changed = true;
    }
    if (img.getAttribute("alt") == null) {
      img.setAttribute("alt", "");
      changed = true;
    }
    if (changed) imgs += 1;
  }
  for (const a of root.querySelectorAll("a")) {
    if (a.getAttribute("target") !== "_blank") continue;
    const rel = a.getAttribute("rel") ?? "";
    if (!/\bnoopener\b/.test(rel)) {
      a.setAttribute("rel", rel ? `${rel} noopener` : "noopener");
      links += 1;
    }
  }
  return { imgs, links };
}

/** The file name of an asset reference, stripped of any query/hash. */
function assetBasename(url: string): string {
  const path = url.split("#")[0]?.split("?")[0] ?? "";
  return path.split("/").filter(Boolean).pop() ?? "";
}

/** An external (http/protocol-relative) or inline (data:) reference. */
function isExternalOrInline(url: string): boolean {
  return /^(https?:)?\/\//i.test(url) || /^data:/i.test(url);
}

/** Resolve a relative URL against a base (the page's own URL), so a fetched
 *  page's images/links keep loading from the live origin. Absolute, data:,
 *  anchor, and mail/tel references are left untouched. */
function absolutize(url: string, base: string): string {
  const u = url.trim();
  if (
    u === "" ||
    u.startsWith("#") ||
    isExternalOrInline(u) ||
    /^(mailto:|tel:|javascript:)/i.test(u)
  ) {
    return url;
  }
  try {
    return new URL(u, base).href;
  } catch {
    return url;
  }
}

/** Rewrite every relative asset URL in a fragment (img/source src+srcset, a href,
 *  inline style url()) to absolute, against the page's base URL. */
function absolutizeAssets(scope: HTMLElement, base: string): void {
  for (const el of scope.querySelectorAll("img,source")) {
    const src = el.getAttribute("src");
    if (src != null && src.trim() !== "") el.setAttribute("src", absolutize(src, base));
    const srcset = el.getAttribute("srcset");
    if (srcset != null && srcset.trim() !== "") {
      el.setAttribute(
        "srcset",
        srcset
          .split(",")
          .map((part) => {
            const bits = part.trim().split(/\s+/);
            if (bits[0]) bits[0] = absolutize(bits[0], base);
            return bits.join(" ");
          })
          .join(", "),
      );
    }
  }
  for (const a of scope.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href != null && href.trim() !== "") a.setAttribute("href", absolutize(href, base));
  }
  for (const el of scope.querySelectorAll("[style]")) {
    const st = el.getAttribute("style") ?? "";
    if (st.includes("url(")) {
      el.setAttribute(
        "style",
        st.replace(CSS_URL, (_w, q: string, ref: string) => `url(${q}${absolutize(ref, base)}${q})`),
      );
    }
  }
}

/** Rewrite one asset URL to `assets/<file>`, or leave external/inline ones. */
function rewriteAssetUrl(url: string): { url: string; localized: boolean; external: boolean } {
  const u = url.trim();
  if (u === "" || u.startsWith("#")) return { url, localized: false, external: false };
  if (isExternalOrInline(u)) return { url, localized: false, external: true };
  const base = assetBasename(u);
  if (base === "") return { url, localized: false, external: false };
  const next = `assets/${base}`;
  return { url: next, localized: next !== u, external: false };
}

/** Rewrite each candidate in a srcset ("a.jpg 1x, b.jpg 2x"). */
function rewriteSrcset(value: string): { value: string; localized: number; external: number } {
  let localized = 0;
  let external = 0;
  const out = value.split(",").map((part) => {
    const seg = part.trim();
    if (seg === "") return part;
    const bits = seg.split(/\s+/);
    const r = rewriteAssetUrl(bits[0] ?? "");
    if (r.localized) localized += 1;
    if (r.external) external += 1;
    bits[0] = r.url;
    return bits.join(" ");
  });
  return { value: out.join(", "), localized, external };
}

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

/** Rewrite url(...) references inside a CSS string. */
function rewriteCssUrls(css: string): { css: string; localized: number; external: number } {
  let localized = 0;
  let external = 0;
  const next = css.replace(CSS_URL, (whole, quote: string, ref: string) => {
    const r = rewriteAssetUrl(ref);
    if (r.localized) localized += 1;
    if (r.external) external += 1;
    return `url(${quote}${r.url}${quote})`;
  });
  return { css: next, localized, external };
}

/**
 * Normalize asset paths to the theme's `assets/` folder. Imported themes point
 * at the old site's layout (`wp-content/themes/x/img/hero.jpg`, `../img/a.png`,
 * a root-absolute `/images/a.jpg`); rewriting each to `assets/<file>` makes the
 * references resolve once the files are dropped into the new theme's assets dir.
 * Covers <img>/<source> src and srcset, inline `style` and <style> CSS url().
 * External/inline references are left as-is and only counted (so the user can
 * choose to bring them in). CLAUDE.md theme format: assets/ holds CSS/JS/images.
 */
function normalizeAssets(root: HTMLElement): { localized: number; external: number } {
  let localized = 0;
  let external = 0;

  // <img>/<source> src
  for (const el of root.querySelectorAll("img,source")) {
    const src = el.getAttribute("src");
    if (src != null && src.trim() !== "") {
      const r = rewriteAssetUrl(src);
      if (r.localized) {
        el.setAttribute("src", r.url);
        localized += 1;
      } else if (r.external) {
        external += 1;
      }
    }
    const srcset = el.getAttribute("srcset");
    if (srcset != null && srcset.trim() !== "") {
      const r = rewriteSrcset(srcset);
      if (r.localized > 0) el.setAttribute("srcset", r.value);
      localized += r.localized;
      external += r.external;
    }
  }

  // inline style="...url(...)..."
  for (const el of root.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") ?? "";
    if (!style.includes("url(")) continue;
    const r = rewriteCssUrls(style);
    if (r.localized > 0) el.setAttribute("style", r.css);
    localized += r.localized;
    external += r.external;
  }

  // <style> blocks
  for (const st of root.querySelectorAll("style")) {
    const css = st.innerHTML;
    if (!css.includes("url(")) continue;
    const r = rewriteCssUrls(css);
    if (r.localized > 0) st.set_content(r.css);
    localized += r.localized;
    external += r.external;
  }

  return { localized, external };
}

/**
 * Neutralize imported forms. An external theme's <form> posts to the old
 * server (a PHP handler, a platform endpoint) that does not exist on a static
 * KUMITO site, so leaving its action/method in place would silently send
 * submissions nowhere. Strip the server-specific attributes, drop hidden
 * server fields (WordPress nonces, referer), and mark the form so the operator
 * wires it to KUMITO's form feature. Fields and labels are kept intact.
 * CLAUDE.md: PHP は使わない / フォームは Firebase で受ける.
 */
function neutralizeForms(root: HTMLElement): number {
  let count = 0;
  for (const form of root.querySelectorAll("form")) {
    form.removeAttribute("action");
    form.removeAttribute("method");
    form.removeAttribute("enctype");
    form.setAttribute("data-form", "imported");
    for (const hidden of form.querySelectorAll('input[type="hidden"]')) hidden.remove();
    count += 1;
  }
  return count;
}

/** class/id keyword → a friendly Japanese section label. */
const CLASS_LABELS: Record<string, string> = {
  hero: "ヒーロー",
  header: "ヘッダー",
  footer: "フッター",
  nav: "ナビゲーション",
  news: "お知らせ",
  about: "紹介",
  contact: "お問い合わせ",
  gallery: "ギャラリー",
  menu: "メニュー",
  products: "商品",
  product: "商品",
  features: "特長",
  feature: "特長",
  pricing: "料金",
  testimonial: "お客様の声",
  testimonials: "お客様の声",
  faq: "よくある質問",
  cta: "行動喚起",
  services: "サービス",
  service: "サービス",
  team: "チーム",
  blog: "ブログ",
};

/**
 * Give each annotated section a meaningful label, derived from its first
 * heading, else a known class/id keyword — so imported sections are legible in
 * the editor instead of "セクション1". Falls back to themeify's generic label.
 */
/**
 * Give each imported section a place to host nested blocks: an empty
 * `data-blocks=""` container (all block types allowed). Sections that already
 * declare one are left alone. This makes an imported theme block-capable from
 * the start (CLAUDE.md: sections host blocks), instead of frozen markup.
 */
export function addBlockSlots(html: string): { html: string; count: number } {
  const root = parse(html, { comment: false });
  let count = 0;
  for (const sec of root.querySelectorAll("[data-section]")) {
    if (sec.querySelector("[data-blocks]")) continue;
    sec.insertAdjacentHTML("beforeend", '<div class="pcms-blocks" data-blocks=""></div>');
    count += 1;
  }
  return { html: root.toString(), count };
}

export function relabelSections(html: string): { html: string; count: number } {
  const root = parse(html, { comment: false });
  let count = 0;
  for (const sec of root.querySelectorAll("[data-section]")) {
    let label = "";
    const heading = sec.querySelector("h1,h2,h3");
    const ht = heading?.text?.trim() ?? "";
    if (ht) label = ht.length > 20 ? `${ht.slice(0, 20)}…` : ht;
    if (!label) {
      const tokens = [
        ...(sec.getAttribute("class") ?? "").split(/\s+/),
        sec.getAttribute("id") ?? "",
      ];
      for (const tkn of tokens) {
        const hit = CLASS_LABELS[tkn.toLowerCase()];
        if (hit) {
          label = hit;
          break;
        }
      }
    }
    if (label) {
      sec.setAttribute("data-label", label);
      count += 1;
    }
  }
  return { html: root.toString(), count };
}

/**
 * Split a shared layout off an imported page. An external page usually carries
 * its chrome — a <header> on top, a <footer> at the bottom — around the part
 * that actually changes per page. When both are present with content between,
 * build a layout.html candidate (chrome + `data-slot="content"`) and return the
 * middle as the page content, so the import becomes a proper layout + template
 * pair instead of one frozen page. The top-level <style> moves into the layout
 * (shared CSS), matching the theme spec's layout.html. CLAUDE.md theme format.
 */
function extractLayout(html: string): { content: string; layout: string | null } {
  const root = parse(html, { comment: false });
  const kids = elementChildren(root);
  const headerIdx = kids.findIndex((k) => tagOf(k) === "header");
  let footerIdx = -1;
  for (let i = kids.length - 1; i >= 0; i--) {
    if (tagOf(kids[i] as HTMLElement) === "footer") {
      footerIdx = i;
      break;
    }
  }
  if (headerIdx === -1 || footerIdx === -1 || footerIdx <= headerIdx + 1) {
    return { content: html, layout: null };
  }
  const header = kids[headerIdx] as HTMLElement;
  const footer = kids[footerIdx] as HTMLElement;
  const middle = kids.slice(headerIdx + 1, footerIdx).filter((k) => tagOf(k) !== "style");
  if (middle.length === 0) return { content: html, layout: null };
  const styleHtml = kids
    .filter((k) => tagOf(k) === "style")
    .map((k) => k.toString())
    .join("\n");
  const layout =
    (styleHtml ? `${styleHtml}\n` : "") +
    `${header.toString()}\n<div data-slot="content"></div>\n${footer.toString()}`;
  const content = middle.map((k) => k.toString()).join("\n");
  return { content, layout };
}

/** True when the raw markup is (starts with) an SVG — e.g. a Figma export. */
function looksLikeSvg(raw: string): boolean {
  return /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/i.test(raw);
}

/**
 * Import a Figma/SVG export: strip scripts, wrap the <svg> in a section, and
 * make its <text> nodes editable. The vector art is kept intact (its own
 * <style>/<defs> stay inside the svg).
 */
function importSvg(raw: string): ImportResult {
  const notes: string[] = [];
  const s = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const root = parse(s, { comment: false });
  const svg = root.querySelector("svg");
  if (!svg) {
    return { html: "", issues: [{ level: "error", message: "SVGを認識できませんでした。" }], notes };
  }
  for (const el of svg.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      if (name.toLowerCase().startsWith("on")) el.removeAttribute(name);
    }
  }
  let f = 0;
  for (const el of svg.querySelectorAll("text")) {
    if (el.getAttribute("data-field") != null) continue;
    f += 1;
    el.setAttribute("data-field", `sec-1.f${f}`);
    el.setAttribute("data-type", "text");
    el.setAttribute("data-label", "テキスト");
  }
  const themed = `<section data-section="sec-1" data-label="デザイン">${svg.toString()}</section>`;
  notes.push("Figma/SVGとして取り込みました。");
  notes.push(
    f > 0
      ? `${f}個のテキストを編集可能にしました。`
      : "テキスト要素は見つかりませんでした（図版として取り込み）。",
  );
  return { html: themed, issues: validateThemeHtml(themed), notes };
}

/** Theme-file names that are page templates rather than reusable sections. */
const TEMPLATE_STEMS = new Set([
  "index",
  "home",
  "front-page",
  "page",
  "post",
  "single",
  "archive",
  "category",
  "search",
  "404",
]);

/**
 * Guess where an imported file should be saved from its name: a page template
 * (index/page/post/…) vs. a reusable section, plus a slug. Used to pre-fill the
 * save target, especially for multi-file import. Pure: name in, suggestion out.
 */
export function suggestThemePart(filename: string): {
  slug: string;
  target: "section" | "template";
} {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const slug = stem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const target = TEMPLATE_STEMS.has(slug) ? "template" : "section";
  return { slug, target };
}

// ---------------------------------------------------------------------------
// ZIP import — classify a theme archive's files and inline its images.
// ---------------------------------------------------------------------------

/** What kind of theme-archive entry a path is, by its extension. */
export type ZipEntryKind = "markup" | "image" | "ignore";

const MARKUP_EXT = new Set(["html", "htm", "php", "liquid", "twig", "txt", "svg"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "svg"]);

/**
 * Classify one entry of an imported theme archive (zip) by its path. Markup
 * files become sections/templates; images are inlined into that markup; the
 * rest (scripts, fonts, directories, macOS/dot metadata) are ignored.
 * Note: `.svg` is reported as "markup" — a standalone SVG is importable as a
 * design section (see `importSvg`); when an `.svg` is referenced from markup,
 * the UI still offers it to `inlineThemeAssets` by basename, so vector assets
 * resolve either way. Pure: path in, kind out.
 */
export function classifyZipEntry(path: string): ZipEntryKind {
  const norm = path.replace(/\\/g, "/");
  const base = norm.split("/").filter(Boolean).pop() ?? "";
  if (norm.endsWith("/") || base === "") return "ignore"; // directory entry
  if (base.startsWith(".")) return "ignore"; // .DS_Store, dotfiles
  if (/(^|\/)__MACOSX\//.test(norm)) return "ignore"; // macOS archive metadata
  const ext = /\.([a-z0-9]+)$/i.exec(base)?.[1]?.toLowerCase() ?? "";
  if (MARKUP_EXT.has(ext)) return "markup";
  if (IMAGE_EXT.has(ext)) return "image";
  return "ignore";
}

/**
 * Replace local asset references in imported theme HTML with inlined `data:`
 * URLs, so the images that shipped in the archive actually show in the preview
 * and the saved section — the theme working copy holds only strings, with no
 * place for binary files. `assets` maps a file's base name (e.g. "hero.jpg") to
 * its data URL; references whose base name is not in the map are left as-is and
 * reported in `missing`. Covers <img>/<source> src and srcset, inline `style`
 * url() and <style> blocks — the same surfaces as `normalizeAssets`.
 */
export function inlineThemeAssets(
  html: string,
  assets: Record<string, string>,
): { html: string; inlined: number; missing: string[] } {
  let inlined = 0;
  const missing: string[] = [];

  const lookup = (url: string): string | null => {
    const u = url.trim();
    if (u === "" || u.startsWith("#") || isExternalOrInline(u)) return null;
    const base = assetBasename(u);
    if (base === "") return null;
    const hit = assets[base];
    if (hit != null) return hit;
    missing.push(base);
    return null;
  };

  const inlineSrcset = (value: string): string =>
    value
      .split(",")
      .map((part) => {
        const seg = part.trim();
        if (seg === "") return part;
        const bits = seg.split(/\s+/);
        const data = lookup(bits[0] ?? "");
        if (data) {
          bits[0] = data;
          inlined += 1;
        }
        return bits.join(" ");
      })
      .join(", ");

  const inlineCss = (css: string): string =>
    css.replace(CSS_URL, (whole, quote: string, ref: string) => {
      const data = lookup(ref);
      if (!data) return whole;
      inlined += 1;
      return `url(${quote}${data}${quote})`;
    });

  const root = parse(html, { comment: false });

  for (const el of root.querySelectorAll("img,source")) {
    const src = el.getAttribute("src");
    if (src != null && src.trim() !== "") {
      const data = lookup(src);
      if (data) {
        el.setAttribute("src", data);
        inlined += 1;
      }
    }
    const srcset = el.getAttribute("srcset");
    if (srcset != null && srcset.trim() !== "") {
      el.setAttribute("srcset", inlineSrcset(srcset));
    }
  }

  for (const el of root.querySelectorAll("[style]")) {
    const style = el.getAttribute("style") ?? "";
    if (style.includes("url(")) el.setAttribute("style", inlineCss(style));
  }

  for (const st of root.querySelectorAll("style")) {
    const css = st.innerHTML;
    if (css.includes("url(")) st.set_content(inlineCss(css));
  }

  return { html: root.toString(), inlined, missing };
}

/**
 * Import an external theme/template: clean it, detect menus and repeating
 * lists, annotate with the themeify heuristics, and validate. A Figma/SVG
 * export is handled directly (wrapped as a design section with editable text).
 */
export function importThemeHtml(raw: string): ImportResult {
  if (looksLikeSvg(raw)) return importSvg(raw);

  const { html: cleaned, notes } = cleanImportedHtml(raw);

  const root = parse(cleaned, { comment: false });
  const menus = detectMenus(root);
  const repeats = markRepeats(root);
  const opt = optimizeMedia(root);
  const assets = normalizeAssets(root);
  const forms = neutralizeForms(root);
  const { html: themed, count: labelled } = relabelSections(themeifyHtml(root.toString()));
  const { html: withBlocks, count: blockSlots } = addBlockSlots(themed);
  const { content, layout } = extractLayout(withBlocks);
  const issues = validateThemeHtml(content);

  if (labelled > 0) notes.push("セクション名を内容から自動で付けました。");
  if (blockSlots > 0) {
    notes.push("各セクションにブロック（パーツ）を追加できる置き場を用意しました。");
  }
  if (layout) {
    notes.push("ヘッダーとフッターを共通レイアウト（layout.html）として分離しました。");
  }

  if (opt.imgs > 0) {
    notes.push(`${opt.imgs}個の画像を最適化しました（遅延読み込み・alt補完）。`);
  }
  if (opt.links > 0) {
    notes.push(`${opt.links}個の外部リンクに rel="noopener" を付与しました。`);
  }
  if (assets.localized > 0) {
    notes.push(`${assets.localized}個の画像パスを assets/ に揃えました。`);
  }
  if (assets.external > 0) {
    notes.push(`${assets.external}個の外部画像があります（必要に応じて取り込んでください）。`);
  }
  if (forms > 0) {
    notes.push(
      `${forms}個のフォームを検出しました（送信先を外しました。KUMITOのフォーム機能に接続してください）。`,
    );
  }
  if (menus > 0) notes.push(`${menus}個のメニュー（ナビ）を検出しました。`);
  if (repeats > 0) {
    notes.push(`${repeats}個の繰り返し（リスト）を検出し、増減できる項目にしました。`);
  }
  const sections = (content.match(/data-section=/g) ?? []).length;
  if (sections > 0) notes.push(`${sections}個の編集できるセクションを検出しました。`);
  return { html: content, issues, notes, ...(layout ? { layout } : {}) };
}

/** Result of importing a rendered page: a full layout + content template + the
 *  folded stylesheet, ready to save as a theme (parallels WpImportResult). */
export interface RenderedImportResult {
  /** The page body as editable sections — goes to templates/index.html. */
  html: string;
  /** A full-document layout.html: head links /assets/style.css, body carries the
   *  page's header/footer chrome around a `data-slot="content"`. */
  layout: string;
  /** Every stylesheet the page used, folded into one — goes to assets/style.css. */
  css: string;
  issues: AiIssue[];
  notes: string[];
}

/** Find the element that actually holds the page chrome (header / main / footer),
 *  descending through the wrapper `<div>`s a rendered page nests them in
 *  (`<div id="page"><div class="site-content">…`). */
function findChromeHost(root: HTMLElement): HTMLElement {
  let cur = root;
  for (let depth = 0; depth < 5; depth++) {
    const kids = elementChildren(cur);
    if (kids.some((k) => ["header", "footer", "main"].includes(tagOf(k)))) return cur;
    // Unwrap a single wrapper element, or dive into the one branch that holds the
    // chrome deeper down; otherwise stop here.
    if (kids.length === 1 && kids[0] && elementChildren(kids[0]).length > 0) {
      cur = kids[0];
      continue;
    }
    const branch = kids.find((k) => k.querySelector("header, main, footer"));
    if (!branch) break;
    cur = branch;
  }
  return cur;
}

/** The content region of a chrome host: its `<main>` if it has one, else the
 *  children between the header and the footer. Returns inner HTML to themeify. */
function contentRegionHtml(host: HTMLElement): string {
  const kids = elementChildren(host);
  const main = kids.find((k) => tagOf(k) === "main");
  if (main) return main.innerHTML;
  const headerIdx = kids.findIndex((k) => tagOf(k) === "header");
  let footerIdx = -1;
  for (let i = kids.length - 1; i >= 0; i--) {
    if (tagOf(kids[i] as HTMLElement) === "footer") {
      footerIdx = i;
      break;
    }
  }
  const from = headerIdx === -1 ? 0 : headerIdx + 1;
  const to = footerIdx === -1 ? kids.length : footerIdx;
  return kids
    .slice(from, to)
    .map((k) => k.toString())
    .join("\n");
}

/**
 * Import a RENDERED page — the HTML a browser actually received from the live
 * site, plus the stylesheet files it linked — into a pcms theme. Unlike a WP
 * ZIP (a program whose design only appears when PHP runs against a database),
 * a rendered page already has every section expanded and every class present,
 * so this is the high-fidelity path for reproducing a site's design.
 *
 * Pure: the caller (desktop/editor) supplies the linked CSS as text keyed by
 * file name (from a saved "complete" page or a fetch); the engine folds all CSS
 * — inline <style> and linked files, in document order — into one
 * assets/style.css, lifts the header/footer into a shared layout.html, and
 * splits the main content into editable sections. CLAUDE.md: engine は純粋 TS.
 */
export function importRenderedPage(input: {
  html: string;
  css?: Record<string, string>;
  lang?: string;
  /** The page's own URL. When given (a fetched page), relative image/link/url()
   *  references are resolved to absolute so they keep loading from the origin. */
  baseUrl?: string;
}): RenderedImportResult {
  const notes: string[] = [];
  const lang = input.lang ?? "ja";
  const cssMap = input.css ?? {};
  const baseUrl = input.baseUrl;

  // Strip server code and scripts before parsing (a rendered page may still
  // carry inline <script> and, if it was saved from a CMS, stray <?php ?>).
  const s = input.html
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const doc = parse(s, { comment: false });

  // 1. Collect CSS in document order: each <link rel="stylesheet"> resolved from
  //    the supplied files, then the page's inline <style>. External stylesheets
  //    we were NOT given (CDN frameworks, Google Fonts) stay as <link> tags in
  //    the layout head so the look is preserved.
  const cssParts: string[] = [];
  const externalStyleTags: string[] = [];
  let linked = 0;
  let inlineStyles = 0;
  let unresolved = 0;
  for (const link of doc.querySelectorAll("link")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    if (!/\bstylesheet\b/.test(rel)) continue;
    const href = (link.getAttribute("href") ?? "").trim();
    if (href === "") continue;
    const base = assetBasename(href);
    const text = cssMap[base] ?? cssMap[href];
    if (text != null) {
      cssParts.push(`/* ${base} */\n${text}`);
      linked += 1;
      link.remove();
    } else if (isExternalOrInline(href)) {
      // Keep the external stylesheet (fonts / CDN) as a head link.
      externalStyleTags.push(`    ${link.toString()}`);
      link.remove();
    } else if (baseUrl) {
      // A same-origin stylesheet we weren't given: keep it as an absolute link so
      // the browser still loads it from the live site.
      link.setAttribute("href", absolutize(href, baseUrl));
      externalStyleTags.push(`    ${link.toString()}`);
      link.remove();
    } else {
      unresolved += 1;
      link.remove();
    }
  }
  // Keep font preconnect/preload hints (Google Fonts) in the head too.
  for (const link of doc.querySelectorAll("link")) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    if (/\b(preconnect|dns-prefetch)\b/.test(rel)) {
      externalStyleTags.push(`    ${link.toString()}`);
      link.remove();
    }
  }
  for (const st of doc.querySelectorAll("style")) {
    const css = st.innerHTML.trim();
    if (css !== "") {
      cssParts.push(css);
      inlineStyles += 1;
    }
    st.remove();
  }
  // A fetched page's folded CSS keeps its url() refs pointing at the live origin;
  // a saved/pasted page's relative url()s are re-pointed to the flattened assets/.
  let css = cssParts.join("\n\n");
  css = baseUrl
    ? css.replace(CSS_URL, (_w, q: string, ref: string) => `url(${q}${absolutize(ref, baseUrl)}${q})`)
    : rewriteCssUrls(css).css;

  // 2. The body is what we theme. Sanitize event handlers and javascript: URLs.
  const body = doc.querySelector("body") ?? doc;
  for (const el of body.querySelectorAll("*")) {
    for (const name of Object.keys(el.attributes)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on")) el.removeAttribute(name);
      else if (
        (lower === "href" || lower === "src") &&
        /^\s*javascript:/i.test(el.getAttribute(name) ?? "")
      ) {
        el.setAttribute(name, "#");
      }
    }
  }

  // For a fetched page, resolve relative image/link/url() refs to absolute BEFORE
  // normalizeAssets, so they stay external (loaded from the origin) instead of
  // being pointed at an assets/ folder we have no bytes for.
  if (baseUrl) absolutizeAssets(body, baseUrl);

  const menus = detectMenus(body);
  // NB: unlike importThemeHtml, a rendered page is NOT run through markRepeats.
  // That collapses a repeating group (a card grid, a news list) to one empty
  // editable template, which then renders as nothing without saved data — it
  // would delete the very content we fetched this page to reproduce. Here the
  // real items are kept verbatim; editability can be added per-section later.
  const opt = optimizeMedia(body);
  const assets = normalizeAssets(body);
  const forms = neutralizeForms(body);

  // 3. Locate the chrome host, lift header/footer into a layout, and split the
  //    content region into editable sections.
  const host = findChromeHost(body);
  const kids = elementChildren(host);
  const header = kids.find((k) => tagOf(k) === "header");
  let footer: HTMLElement | undefined;
  for (let i = kids.length - 1; i >= 0; i--) {
    if (tagOf(kids[i] as HTMLElement) === "footer") {
      footer = kids[i];
      break;
    }
  }
  const regionHtml = header || footer ? contentRegionHtml(host) : body.innerHTML;

  const { html: themed, count: labelled } = relabelSections(themeifyHtml(regionHtml));
  const { html: content, count: blockSlots } = addBlockSlots(themed);

  const headerMarkup = header ? header.toString() : "";
  const footerMarkup = footer ? footer.toString() : "";
  const layout =
    `<!doctype html>\n<html lang="${lang}">\n  <head>\n` +
    `    <meta charset="utf-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1" />\n` +
    `    <title data-field="site.name"></title>\n` +
    (externalStyleTags.length ? `${externalStyleTags.join("\n")}\n` : "") +
    `    <link rel="stylesheet" href="/assets/style.css" />\n` +
    `  </head>\n  <body>\n` +
    `    <div data-slot="header">${headerMarkup}</div>\n\n` +
    `    <main data-slot="content"></main>\n\n` +
    `    <div data-slot="footer">${footerMarkup}</div>\n` +
    `  </body>\n</html>\n`;

  const issues = validateThemeHtml(content);

  const foldedCount = linked + inlineStyles;
  if (foldedCount > 0) {
    notes.push(`${foldedCount}件のCSS（外部${linked}・インライン${inlineStyles}）を1つにまとめ、assets/style.css にしました。`);
  }
  if (externalStyleTags.length > 0) {
    notes.push(`${externalStyleTags.length}件の外部CSS（Webフォント・CDN）はそのままリンクで残しました。`);
  }
  if (unresolved > 0) {
    notes.push(`${unresolved}件のCSSファイルが見つかりませんでした（ページと一緒に保存すると取り込めます）。`);
  }
  if (header || footer) {
    notes.push("ヘッダー・フッターを共通レイアウト（layout.html）として分離しました。");
  }
  if (labelled > 0) notes.push("セクション名を内容から自動で付けました。");
  if (blockSlots > 0) notes.push("各セクションにブロックを追加できる置き場を用意しました。");
  if (opt.imgs > 0) notes.push(`${opt.imgs}個の画像を最適化しました（遅延読み込み・alt補完）。`);
  if (assets.external > 0) {
    notes.push(`${assets.external}個の外部画像があります（必要に応じて取り込んでください）。`);
  }
  if (forms > 0) {
    notes.push(`${forms}個のフォームを検出しました（送信先を外しました。KUMITOのフォーム機能に接続してください）。`);
  }
  if (menus > 0) notes.push(`${menus}個のメニュー（ナビ）を検出しました。`);
  const sectionCount = (content.match(/data-section=/g) ?? []).length;
  notes.push(`${sectionCount}個の編集できるセクションに分割しました。`);

  return { html: content, layout, css, issues, notes };
}
