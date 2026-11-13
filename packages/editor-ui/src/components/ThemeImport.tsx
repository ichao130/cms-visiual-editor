import { useMemo, useRef, useState, type DragEvent } from "react";
import { unzipSync } from "fflate";
import { Icon } from "./Icon.js";
import {
  importThemeHtml,
  importRenderedPage,
  collectInternalLinks,
  suggestThemePart,
  diagnoseThemeHtml,
  classifyZipEntry,
  inlineThemeAssets,
  detectWpThemeKind,
  importWpTheme,
  synthesizeFseCss,
  localizeCssUrls,
  bytesToDataUrl,
  assetContentType,
  type ImportResult,
  type RenderedImportResult,
  type DiscoveredPage,
  type ImportSource,
  type WpImportFile,
  type WpImportResult,
  type WpImportWizard,
} from "@pcms/engine";
import type { PcmsApi } from "../api/types.js";
import { useDialog } from "../state/useDialog.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  onClose: () => void;
  /** Called after a whole theme is imported as a new, active theme. */
  onImported?: () => void;
}

/** A complete theme ready to be added as a new, separate theme. */
interface WpThemeImport {
  name: string;
  kind: WpImportResult["kind"];
  files: Record<string, string>;
  notes: string[];
  fallbackBatch: BatchItem[];
  /** Wizard data: top-page candidates, importable 固定ページ, unresolved content. */
  wizard: WpImportWizard;
}

const SOURCES: ImportSource[] = ["auto", "wordpress", "shopify", "figma", "html", "other"];

/** One file in a multi-file (batch) import. */
interface BatchItem {
  name: string;
  result: ImportResult;
  slug: string;
  target: "section" | "template";
  include: boolean;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Images larger than this are skipped (keeps the saved theme reasonable). */
const ASSET_SIZE_CAP = 4 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
}

/** Base64-encode bytes in chunks (avoids the arg-count limit of btoa+spread). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** A `data:` URL for an image file, by its extension. */
function imageDataUrl(path: string, bytes: Uint8Array): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(baseName(path))?.[1]?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** The theme name a WordPress import recorded in its theme.json, if any. */
function readWpThemeName(themeJson: string | undefined): string | null {
  if (!themeJson) return null;
  try {
    const name = (JSON.parse(themeJson) as { name?: unknown }).name;
    return typeof name === "string" && name.trim() !== "" ? name : null;
  } catch {
    return null;
  }
}

/**
 * Flatten a WordPress import into a complete theme file map (path → content):
 * theme.json / layout.html / templates / sections / blocks, every CSS file in
 * the archive folded into assets/style.css (the look is carried verbatim), and
 * each referenced image as assets/<basename> (a data URL). This is what gets
 * written as a new, self-contained theme.
 */
function buildWpThemeFiles(
  wp: WpImportResult,
  cssText: string,
  imageAssets: Record<string, string>,
  jsAssets: Record<string, string>,
): Record<string, string> {
  const files: Record<string, string> = {};
  const f = wp.files;
  if (f["theme.json"]) files["theme.json"] = f["theme.json"];
  for (const [k, v] of Object.entries(f.templates)) files[`templates/${k}.html`] = v;
  for (const [k, v] of Object.entries(f.sections)) files[`sections/${k}.html`] = v;
  for (const [k, v] of Object.entries(f.blocks)) files[`blocks/${k}.html`] = v;
  // Re-point the stylesheet's local url(...) refs (fonts, background images) to
  // /assets/ so they resolve once every asset is flattened into that folder.
  if (cssText.trim() !== "") files["assets/style.css"] = localizeCssUrls(cssText);
  // Carry EVERY image from the archive (not only referenced ones).
  for (const [base, url] of Object.entries(imageAssets)) files[`assets/${base}`] = url;
  // Carry EVERY script file verbatim, but DON'T link them all: the layout the
  // engine built already loads exactly the theme's enqueued/inline scripts. A WP
  // theme ships a whole vendor folder (a dozen anime.js versions, duplicate
  // jQuery, slick.js + slick.min.js); loading all of them breaks the page with
  // conflicting globals. The unreferenced files stay on disk (so a dynamic load
  // still resolves) but are never auto-linked (the engine suppresses that for a
  // theme that manages its own scripts).
  for (const [base, text] of Object.entries(jsAssets)) files[`assets/${base}`] = text;
  if (f["layout.html"]) files["layout.html"] = f["layout.html"];
  // The theme's default page composition (home + each imported 固定ページ). The
  // backend's presetSettingsFor reads this when the theme becomes active.
  if (f.preset) files["presets/pages.json"] = f.preset;
  return files;
}

/** A generic title+body template for themes that only shipped a home page, so
 *  non-home content (個別の固定ページ・投稿) still renders after a rendered import. */
const RENDERED_GENERIC_ENTRY =
  '<article class="entry">\n' +
  '  <h1 data-field="post.title" data-type="text" data-label="タイトル"></h1>\n' +
  '  <div data-slot="content" data-field="post.body" data-type="richtext" data-label="本文"></div>\n' +
  "</article>";

/** A full HTML document (a browser-rendered page), vs. a theme fragment/template. */
function looksLikeRenderedPage(html: string): boolean {
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html);
}

/** A discovered 固定ページ reproduced alongside the home: its main region (from a
 *  second rendered-page import) becomes a per-slug template pinned to its URL. */
interface RenderedExtraPage {
  slug: string;
  title: string;
  html: string;
}

/** Turn a hand-typed page URL into a candidate page (slug + label), or null if it
 *  isn't a usable http(s) page URL or points at the site root (the home, which is
 *  already the index). The slug is the URL path: "/about/" → "about". */
function pageFromUrl(raw: string): DiscoveredPage | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const slug = u.pathname.replace(/\/?index\.html?$/i, "").replace(/^\/+|\/+$/g, "");
  if (slug === "") return null; // the site root = the home, not a 固定ページ
  u.hash = "";
  const label = decodeURIComponent(slug.split("/").pop() ?? slug) || slug;
  return { url: u.href, slug, label };
}

/** A flat, unique template name for a page slug: "about" → "page-about",
 *  "company/profile" → "page-company-profile" (template files can't nest on the
 *  page's URL path). */
function flatTemplateToken(slug: string, used: Set<string>): string {
  const base = slug.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "page";
  let token = `page-${base}`;
  for (let n = 2; used.has(token); n++) token = `page-${base}-${n}`;
  used.add(token);
  return token;
}

/** Assemble a saveable theme from a rendered-page import: the folded stylesheet
 *  becomes assets/style.css, the chrome becomes layout.html, the body is the
 *  home template, plus generic page/post templates and every carried image. Any
 *  discovered 固定ページ (`extraPages`) each become their own template + a
 *  presets/pages.json entry, so switching to the theme brings the whole site —
 *  /about/, /service/, … — across, not just the home. */
function buildRenderedThemeFiles(
  r: RenderedImportResult,
  name: string,
  imageAssets: Record<string, string>,
  extraPages: RenderedExtraPage[] = [],
): Record<string, string> {
  const files: Record<string, string> = {};
  files["theme.json"] = JSON.stringify({ name }, null, 2);
  files["layout.html"] = r.layout;
  files["templates/index.html"] = r.html;
  files["templates/page.html"] = RENDERED_GENERIC_ENTRY;
  files["templates/post.html"] = RENDERED_GENERIC_ENTRY;
  if (r.css.trim() !== "") files["assets/style.css"] = localizeCssUrls(r.css);
  for (const [base, url] of Object.entries(imageAssets)) files[`assets/${base}`] = url;
  if (extraPages.length > 0) {
    const pages: Record<string, { template: string; title?: string }> = {
      index: { template: "index" },
    };
    const used = new Set<string>();
    for (const p of extraPages) {
      const token = flatTemplateToken(p.slug, used);
      files[`templates/${token}.html`] = p.html;
      pages[p.slug] = { template: token, title: p.title };
    }
    files["presets/pages.json"] = JSON.stringify({ pages, regions: {} }, null, 2);
  }
  return files;
}

/**
 * Apply the import wizard's choices to the theme files before they are saved:
 *  • the chosen top-page template becomes templates/index.html (a theme can ship
 *    front-page / home / index — the operator picks which is the home);
 *  • presets/pages.json is rebuilt to the home plus only the 固定ページ the operator
 *    kept checked, so excluded template-variant pages don't ship as real pages.
 * The theme's own template files are left intact; only index.html and the preset
 * change, so nothing else about the import is disturbed.
 */
function applyWizardChoices(
  wp: WpThemeImport,
  homeChoice: string,
  includedPages: Record<string, boolean>,
): Record<string, string> {
  const files = { ...wp.files };
  const chosen = wp.wizard.home.candidates.find((c) => c.stem === homeChoice);
  if (chosen) files["templates/index.html"] = chosen.html;
  const pages: Record<string, { template: string; title?: string }> = { index: { template: "index" } };
  for (const p of wp.wizard.pages) {
    if (includedPages[p.id] === false) continue;
    pages[p.id] = { template: p.template, title: p.title };
  }
  files["presets/pages.json"] = JSON.stringify({ pages, regions: {} }, null, 2);
  return files;
}

/**
 * Import an external theme/template (WordPress, Shopify, any HTML) and optimize
 * it into a pcms theme fragment: strip server/template code and scripts, add
 * editable data-* annotations, validate, preview, then save it as a reusable
 * section in the theme working copy. CLAUDE.md: テーマ元ファイルは不変 / 人が適用を選ぶ.
 */
export function ThemeImport({ api, onClose, onImported }: Props) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const toast = useToast();
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState<ImportSource>("auto");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [partName, setPartName] = useState("");
  const [target, setTarget] = useState<"section" | "template">("section");
  const [saveLayout, setSaveLayout] = useState(true);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [wpImport, setWpImport] = useState<WpThemeImport | null>(null);
  // A rendered-page import (the high-fidelity design path): a whole theme built
  // from the live page's HTML + CSS, offered as a new theme.
  const [renderedImport, setRenderedImport] = useState<{
    name: string;
    home: RenderedImportResult;
    imageAssets: Record<string, string>;
    baseUrl?: string;
    discovered: DiscoveredPage[];
    notes: string[];
  } | null>(null);
  // Which pages to also fetch & reproduce (keyed by slug). Seeded from the nav,
  // but the operator can add any page by URL — the nav is only a convenience.
  const [includedLinks, setIncludedLinks] = useState<Record<string, boolean>>({});
  // Page URLs the operator added by hand (beyond whatever the nav turned up).
  const [addedPages, setAddedPages] = useState<DiscoveredPage[]>([]);
  const [addUrl, setAddUrl] = useState("");
  const [themeNameInput, setThemeNameInput] = useState("");
  // Import-wizard choices: which template is the top page, and which 固定ページ to create.
  const [homeChoice, setHomeChoice] = useState("");
  const [includedPages, setIncludedPages] = useState<Record<string, boolean>>({});
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [fetchUrl, setFetchUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const hasErrors = errors.length > 0;
  const slug = useMemo(() => slugify(partName), [partName]);
  const diagnoses = useMemo(() => (result ? diagnoseThemeHtml(result.html) : []), [result]);

  // Offer a rendered page as a whole new theme: fold its CSS, lift its chrome,
  // split its body into sections, and stage it for the "new theme" confirm.
  const offerRenderedPage = (
    html: string,
    cssMap: Record<string, string>,
    imageAssets: Record<string, string>,
    suggestedName: string,
    baseUrl?: string,
    extraNotes: string[] = [],
    discovered: DiscoveredPage[] = [],
  ): void => {
    const r = importRenderedPage(baseUrl ? { html, css: cssMap, baseUrl } : { html, css: cssMap });
    setResult(null);
    setRaw("");
    setBatch(null);
    setWpImport(null);
    setZipNote(null);
    setThemeNameInput(suggestedName);
    const incl: Record<string, boolean> = {};
    for (const d of discovered) incl[d.slug] = true;
    setIncludedLinks(incl);
    setAddedPages([]);
    setAddUrl("");
    setRenderedImport({
      name: suggestedName,
      home: r,
      imageAssets,
      baseUrl,
      discovered,
      notes: [...extraNotes, ...r.notes],
    });
  };

  // Fetch a live page by URL (desktop backend) and offer it as a theme, with
  // its assets kept pointing at the origin via the page's base URL.
  const fetchFromUrl = async () => {
    const url = fetchUrl.trim();
    if (url === "" || !api.fetchRenderedPage) return;
    setFetchingUrl(true);
    try {
      const { html, css, baseUrl, notes } = await api.fetchRenderedPage(url);
      let host = url;
      try {
        host = new URL(baseUrl).hostname.replace(/^www\./, "");
      } catch {
        /* keep the raw url as the name */
      }
      // Discover the same-origin 固定ページ this page links to, so the operator can
      // pull them across too (each fetched & reproduced at import time).
      const discovered = collectInternalLinks(html, baseUrl);
      offerRenderedPage(
        html,
        css,
        {},
        host || t("themeImport.renderedDefaultName"),
        baseUrl,
        notes,
        discovered,
      );
    } catch {
      toast(t("themeImport.fetchFailed"));
    } finally {
      setFetchingUrl(false);
    }
  };

  const convert = () => {
    if (raw.trim() === "") return;
    // A pasted full page (the live site's HTML source) → high-fidelity rendered
    // import; a fragment/template → the per-section themeify path.
    if (looksLikeRenderedPage(raw)) {
      offerRenderedPage(raw, {}, {}, t("themeImport.renderedDefaultName"));
      return;
    }
    const r = importThemeHtml(raw);
    if (source !== "auto") {
      r.notes = [`${t(`themeImport.source.${source}` as never)}として取り込みました。`, ...r.notes];
    }
    setResult(r);
  };

  const onPickFile = () => fileRef.current?.click();

  // Drag-and-drop: accept a dropped ZIP (or HTML/templates) straight into the
  // modal, routing to the same onFiles path as the picker. preventDefault on
  // both dragover and drop, else the browser opens the file and navigates away.
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    // Ignore leaves into a child element (relatedTarget still inside the panel).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragOver(false);
    void onFiles(e.dataTransfer.files);
  };

  const isZip = (f: File) =>
    /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";

  /**
   * Import a theme archive: unzip in the browser, inline its images into each
   * HTML/template as data URLs (the theme working copy holds only strings), and
   * queue the markup as batch items. CLAUDE.md: テーマ元ファイルは不変 / 人が適用を選ぶ.
   */
  const importZip = async (file: File) => {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const assets: Record<string, string> = {};
    let embedded = 0;
    let tooLarge = 0;
    for (const [path, bytes] of Object.entries(entries)) {
      const isImage = classifyZipEntry(path) === "image";
      // Fonts are binary assets too; the CSS points at them (e.g. ../fonts/x.woff),
      // so carry them or custom typefaces fall back to system fonts (a big visual
      // loss). localizeCssUrls re-points those url(...) refs to /assets/.
      const isFont = /\.(woff2?|ttf|otf|eot)$/i.test(path);
      if (!isImage && !isFont) continue;
      if (bytes.length > ASSET_SIZE_CAP) {
        tooLarge += 1;
        continue;
      }
      const url = isImage ? imageDataUrl(path, bytes) : bytesToDataUrl(bytes, assetContentType(path));
      if (url) {
        assets[baseName(path)] = url;
        embedded += 1;
      }
    }

    const decoder = new TextDecoder();
    const items: BatchItem[] = [];
    // Every text file in the archive, for WordPress theme detection/conversion,
    // all CSS folded together (the single stylesheet layout.html links), and
    // every script carried verbatim (the theme's own JS).
    const wpFiles: WpImportFile[] = [];
    const jsAssets: Record<string, string> = {};
    // Every CSS in the archive, kept both as one blind concatenation (the fallback
    // when we can't tell which CSS the theme loads) and keyed by basename (so a WP
    // import can fold in ONLY the stylesheets it actually references, in order).
    let cssText = "";
    const cssByBase: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(entries)) {
      if (/\/$/.test(path)) continue;
      if (/\.(php|html?|json|css|txt|liquid|twig)$/i.test(path)) {
        const text = decoder.decode(bytes);
        wpFiles.push({ path, text });
        if (/\.css$/i.test(path)) {
          cssText += `${cssText ? "\n\n" : ""}/* ${baseName(path)} */\n${text}`;
          cssByBase[baseName(path).toLowerCase()] = text;
        }
      } else if (/\.m?js$/i.test(path)) {
        // Keep every script — the theme's own JS (minified or not).
        jsAssets[baseName(path)] = decoder.decode(bytes);
      }
      if (classifyZipEntry(path) !== "markup") continue;
      const r = importThemeHtml(decoder.decode(bytes));
      r.html = inlineThemeAssets(r.html, assets).html;
      if (r.layout) r.layout = inlineThemeAssets(r.layout, assets).html;
      const s = suggestThemePart(path);
      items.push({
        name: baseName(path),
        result: r,
        slug: s.slug || slugify(baseName(path)),
        target: s.target,
        include: r.issues.every((i) => i.level !== "error"),
      });
    }

    const notes: string[] = [];
    if (embedded > 0) notes.push(t("themeImport.zipImages").replace("{count}", String(embedded)));
    if (tooLarge > 0) {
      notes.push(
        t("themeImport.zipTooLarge")
          .replace("{count}", String(tooLarge))
          .replace("{limit}", `${ASSET_SIZE_CAP / 1024}KB`),
      );
    }

    // A recognised WordPress theme (classic PHP and/or block) is converted as a
    // whole, self-contained theme — the high-fidelity path that keeps CSS and
    // structure — and offered as a new, separate theme. Anything else falls back
    // to the per-file section/template batch below.
    const wpKind = detectWpThemeKind(wpFiles);
    if (wpKind !== "unknown") {
      const wp = importWpTheme(wpFiles);
      // Fold in ONLY the stylesheets the theme actually loads, in load order (the
      // engine resolved them from <link>/wp_enqueue_style). This drops the dead
      // vendor/RTL/docs CSS that otherwise overrides the real design — the main
      // fidelity fix. Fall back to every CSS when the engine found no references.
      const refced = wp.files.styles
        .map((b) => ({ b, text: cssByBase[b.toLowerCase()] }))
        .filter((x): x is { b: string; text: string } => typeof x.text === "string");
      const themeCss =
        refced.length > 0
          ? refced.map((x) => `/* ${x.b} */\n${x.text}`).join("\n\n")
          : cssText;
      // A block/FSE theme keeps most of its look in theme.json presets, which WP
      // turns into --wp--preset--* variables + .has-* utilities + block layout CSS
      // at runtime; the saved markup references them, so without that layer the
      // import renders almost unstyled. Synthesize it from the original theme.json
      // and PREPEND it, so the theme's own CSS still wins the cascade.
      const rawThemeJson = wpFiles.find((x) =>
        /(^|\/)theme\.json$/i.test(x.path.replace(/\\/g, "/")),
      )?.text;
      const { css: fseCss, notes: fseNotes } = synthesizeFseCss(rawThemeJson);
      const wpCss = fseCss
        ? `/* pcms: theme.json presets */\n${fseCss}\n\n${themeCss}`
        : themeCss;
      const files = buildWpThemeFiles(wp, wpCss, assets, jsAssets);
      const name = readWpThemeName(wp.files["theme.json"]) ?? baseName(file.name).replace(/\.zip$/i, "");
      const wpNotes = [...notes, ...wp.notes, ...fseNotes];
      const jsCount = Object.keys(jsAssets).length;
      if (jsCount > 0) wpNotes.push(t("themeImport.wpJs").replace("{count}", String(jsCount)));
      setResult(null);
      setRaw("");
      setBatch(null);
      setZipNote(notes.join(" "));
      setThemeNameInput(name);
      setHomeChoice(wp.wizard.home.chosen);
      setIncludedPages(Object.fromEntries(wp.wizard.pages.map((p) => [p.id, true])));
      setWpImport({ name, kind: wpKind, files, notes: wpNotes, fallbackBatch: items, wizard: wp.wizard });
      return;
    }

    // Not a WordPress theme: a saved "complete" page (rendered HTML + its CSS
    // folder) is the high-fidelity design path — fold it into one theme rather
    // than splitting the archive into disconnected parts.
    const htmlEntries = Object.entries(entries).filter(([p]) => /\.html?$/i.test(p));
    const rendered = htmlEntries
      .map(([p, b]) => ({ p, text: decoder.decode(b) }))
      .filter((x) => looksLikeRenderedPage(x.text))
      .sort(
        (a, b) =>
          (/index\.html?$/i.test(b.p) ? 1 : 0) - (/index\.html?$/i.test(a.p) ? 1 : 0) ||
          b.text.length - a.text.length,
      )[0];
    if (rendered) {
      const cssForRender: Record<string, string> = {};
      for (const [path, bytes] of Object.entries(entries)) {
        if (/\.css$/i.test(path)) cssForRender[baseName(path)] = decoder.decode(bytes);
      }
      const name = baseName(file.name).replace(/\.zip$/i, "") || t("themeImport.renderedDefaultName");
      offerRenderedPage(rendered.text, cssForRender, assets, name);
      return;
    }

    if (items.length === 0) {
      toast(t("themeImport.zipNoMarkup"));
      return;
    }
    setResult(null);
    setRaw("");
    setWpImport(null);
    setZipNote(notes.join(" "));
    setBatch(items);
  };

  const onFiles = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    // A ZIP archive: unzip, inline images, and queue its templates/sections.
    if (list.length === 1 && list[0] && isZip(list[0])) {
      setResult(null);
      await importZip(list[0]);
      return;
    }
    // A single file: a full rendered page → high-fidelity theme; otherwise the
    // paste flow (preview + manual save).
    if (list.length === 1 && list[0]) {
      const only = list[0];
      const text = await only.text();
      if (/\.html?$/i.test(only.name) && looksLikeRenderedPage(text)) {
        const name = baseName(only.name).replace(/\.html?$/i, "") || t("themeImport.renderedDefaultName");
        offerRenderedPage(text, {}, {}, name);
        return;
      }
      setBatch(null);
      setWpImport(null);
      setZipNote(null);
      setResult(null);
      setRaw(text);
      const s = suggestThemePart(only.name);
      if (s.slug) setPartName(s.slug);
      setTarget(s.target);
      return;
    }
    // Several files selected together (a saved page + its CSS): if one is a full
    // rendered page, fold the sibling CSS into a single theme.
    const texts = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
    const page = texts
      .filter((x) => /\.html?$/i.test(x.name) && looksLikeRenderedPage(x.text))
      .sort(
        (a, b) =>
          (/index\.html?$/i.test(b.name) ? 1 : 0) - (/index\.html?$/i.test(a.name) ? 1 : 0) ||
          b.text.length - a.text.length,
      )[0];
    if (page) {
      const cssForRender: Record<string, string> = {};
      for (const x of texts) if (/\.css$/i.test(x.name)) cssForRender[baseName(x.name)] = x.text;
      const name = baseName(page.name).replace(/\.html?$/i, "") || t("themeImport.renderedDefaultName");
      offerRenderedPage(page.text, cssForRender, {}, name);
      return;
    }
    // Otherwise import each and queue them for one batched save.
    const items: BatchItem[] = [];
    for (const x of texts) {
      const r = importThemeHtml(x.text);
      const s = suggestThemePart(x.name);
      items.push({
        name: x.name,
        result: r,
        slug: s.slug || slugify(x.name),
        target: s.target,
        include: r.issues.every((i) => i.level !== "error"),
      });
    }
    setResult(null);
    setWpImport(null);
    setZipNote(null);
    setBatch(items);
  };

  const patchItem = (i: number, patch: Partial<BatchItem>) => {
    setBatch((prev) => prev?.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) ?? prev);
  };

  const saveBatch = async () => {
    if (!batch) return;
    const ready = batch.filter(
      (it) => it.include && it.slug !== "" && it.result.issues.every((i) => i.level !== "error"),
    );
    if (ready.length === 0) return;
    setSaving(true);
    try {
      for (const it of ready) {
        const dir = it.target === "template" ? "templates" : "sections";
        await api.writeThemeFile(`${dir}/${it.slug}.html`, it.result.html);
      }
      toast(t("themeImport.savedBatch").replace("{count}", String(ready.length)));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Add the converted WordPress theme as a new, separate theme and switch to it.
  // Switching resets the page layout to the new theme's defaults; content stays.
  const importAsNewTheme = async () => {
    if (!wpImport) return;
    const name = themeNameInput.trim() || wpImport.name;
    setSaving(true);
    try {
      const files = applyWizardChoices(wpImport, homeChoice, includedPages);
      const summary = await api.createTheme(
        { name, source: source === "auto" ? "wordpress" : source },
        files,
      );
      await api.setActiveTheme(summary.id);
      toast(t("themeImport.importedAsTheme").replace("{name}", name));
      onImported?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // The pages the operator can pull across: the nav-discovered ones plus any
  // added by URL, deduped by slug (a hand-added URL replaces a discovered one of
  // the same slug, keeping its label). The nav is only a convenience — a whole
  // site can be assembled from URLs alone.
  const candidatePages = (): DiscoveredPage[] => {
    const seen = new Map<string, DiscoveredPage>();
    for (const p of renderedImport?.discovered ?? []) seen.set(p.slug, p);
    for (const p of addedPages) seen.set(p.slug, p);
    return [...seen.values()];
  };

  const addManualUrl = () => {
    const p = pageFromUrl(addUrl);
    if (!p) {
      toast(t("themeImport.addUrlInvalid"));
      return;
    }
    const exists =
      (renderedImport?.discovered ?? []).some((d) => d.slug === p.slug) ||
      addedPages.some((d) => d.slug === p.slug);
    if (!exists) setAddedPages((prev) => [...prev, p]);
    setIncludedLinks((m) => ({ ...m, [p.slug]: true }));
    setAddUrl("");
  };

  // Add the rendered page as a new, separate theme and switch to it.
  const importRenderedAsNewTheme = async () => {
    if (!renderedImport) return;
    const name = themeNameInput.trim() || renderedImport.name;
    setSaving(true);
    try {
      // Fetch & reproduce each checked 固定ページ, so the whole site comes across.
      const extraPages: RenderedExtraPage[] = [];
      const failed: string[] = [];
      const toFetch = candidatePages().filter((d) => includedLinks[d.slug] !== false);
      if (api.fetchRenderedPage && toFetch.length > 0) {
        for (const p of toFetch) {
          try {
            const res = await api.fetchRenderedPage!(p.url);
            const pr = importRenderedPage({
              html: res.html,
              css: res.css,
              baseUrl: res.baseUrl || p.url,
            });
            extraPages.push({ slug: p.slug, title: p.label, html: pr.html });
          } catch {
            failed.push(p.label);
          }
        }
      }
      const files = buildRenderedThemeFiles(
        renderedImport.home,
        name,
        renderedImport.imageAssets,
        extraPages,
      );
      files["theme.json"] = JSON.stringify({ name }, null, 2);
      const summary = await api.createTheme({ name, source: "html" }, files);
      await api.setActiveTheme(summary.id);
      let msg = t("themeImport.importedAsTheme").replace("{name}", name);
      if (extraPages.length > 0) {
        msg += t("themeImport.renderedPagesAdded").replace("{count}", String(extraPages.length));
      }
      if (failed.length > 0) {
        msg += t("themeImport.renderedPagesFailed").replace("{count}", String(failed.length));
      }
      toast(msg);
      onImported?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // Fall back to adding the WordPress theme's parts to the current theme instead.
  const wpToBatch = () => {
    if (!wpImport) return;
    if (wpImport.fallbackBatch.length === 0) {
      toast(t("themeImport.zipNoMarkup"));
      return;
    }
    setWpImport(null);
    setBatch(wpImport.fallbackBatch);
  };

  const aiFinish = async () => {
    if (!result) return;
    setAiBusy(true);
    try {
      const r = await api.aiThemeify(result.html);
      setResult({
        html: r.html,
        issues: r.issues,
        notes: [...result.notes, "AIで仕上げました。"],
        ...(result.layout ? { layout: result.layout } : {}),
      });
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!result || hasErrors || slug === "") return;
    setSaving(true);
    try {
      const dir = target === "template" ? "templates" : "sections";
      const saved = [`${dir}/${slug}.html`];
      await api.writeThemeFile(`${dir}/${slug}.html`, result.html);
      if (result.layout && saveLayout) {
        await api.writeThemeFile("layout.html", result.layout);
        saved.push("layout.html");
      }
      toast(t("themeImport.saved").replace("{name}", saved.join("、")));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // When a shared layout was split off, preview the composed page (chrome with
  // the content dropped into the slot) so it reads as the real page.
  const previewBody = result
    ? result.layout
      ? result.layout.replace('<div data-slot="content"></div>', result.html)
      : result.html
    : "";
  const previewDoc = result
    ? `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;color:#1e1f22;line-height:1.6}` +
      `img{max-width:100%;height:auto}[data-section]{outline:1px dashed #c9deff;padding:8px;margin:8px 0}` +
      `</style></head><body>${previewBody}</body></html>`
    : "";

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("themeImport.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div
        className={`pcms-modal__panel pcms-modal__panel--wide${dragOver ? " is-dragover" : ""}`}
        ref={ref}
        tabIndex={-1}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="pcms-themeimport__dropzone" aria-hidden="true">
            <Icon name="folder" size={28} />
            <span>{t("themeImport.dropHint")}</span>
          </div>
        )}
        <header className="pcms-modal__head">
          <h2>{t("themeImport.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="pcms-themeimport__hint">{t("themeImport.hint")}</p>
        <p className="pcms-themeimport__rendered-hint">{t("themeImport.renderedHint")}</p>
        {api.fetchRenderedPage && !batch && !wpImport && !renderedImport && (
          <div className="pcms-themeimport__urlrow">
            <input
              type="url"
              className="pcms-themeimport__url"
              value={fetchUrl}
              onChange={(e) => setFetchUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchFromUrl();
              }}
              placeholder={t("themeImport.urlPlaceholder")}
            />
            <button
              type="button"
              className="pcms-primary"
              onClick={() => void fetchFromUrl()}
              disabled={fetchingUrl || fetchUrl.trim() === ""}
            >
              {fetchingUrl ? t("themeImport.urlFetching") : t("themeImport.urlFetch")}
            </button>
          </div>
        )}
        {source === "figma" && (
          <p className="pcms-themeimport__figmahint">{t("themeImport.figmaHint")}</p>
        )}

        <div className="pcms-themeimport__controls">
          <label className="pcms-themeimport__sourcefield">
            <span>{t("themeImport.source")}</span>
            <select value={source} onChange={(e) => setSource(e.target.value as ImportSource)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`themeImport.source.${s}` as never)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onPickFile}>
            {t("themeImport.pickFile")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,.php,.liquid,.twig,.svg,.txt,.zip,text/html,image/svg+xml,application/zip"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <span className="pcms-themeimport__filehint">{t("themeImport.pickFileHint")}</span>
        </div>

        {!batch && !wpImport && !renderedImport && (
          <textarea
            className="pcms-themeimport__input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t("themeImport.paste")}
            rows={8}
          />
        )}

        {!batch && !wpImport && !renderedImport && (
          <div className="pcms-themeimport__actions">
            <button className="pcms-primary" onClick={convert} disabled={raw.trim() === ""}>
              {t("themeImport.convert")}
            </button>
            {result && (
              <button className="pcms-aibtn" onClick={() => void aiFinish()} disabled={aiBusy}>
                {aiBusy ? t("ai.generating") : t("themeImport.aiFinish")}
              </button>
            )}
          </div>
        )}

        {wpImport && (
          <div className="pcms-themeimport__wp">
            <h3>{t("themeImport.wpTitle")}</h3>
            <p className="pcms-themeimport__hint">
              {t(`themeImport.wpKind.${wpImport.kind}` as never)}
            </p>
            <label className="pcms-themeimport__wpname">
              <span>{t("themeImport.newThemeName")}</span>
              <input
                type="text"
                value={themeNameInput}
                onChange={(e) => setThemeNameInput(e.target.value)}
                placeholder={wpImport.name}
              />
            </label>
            <ul className="pcms-themeimport__wpfiles">
              <li>{t("themeImport.wpTemplates").replace(
                "{count}",
                String(Object.keys(wpImport.files).filter((p) => p.startsWith("templates/")).length),
              )}</li>
              <li>{t("themeImport.wpAssets").replace(
                "{count}",
                String(Object.keys(wpImport.files).filter((p) => p.startsWith("assets/")).length),
              )}</li>
            </ul>

            {wpImport.wizard.home.candidates.length > 1 && (
              <fieldset className="pcms-themeimport__wiz">
                <legend>{t("themeImport.wizHome")}</legend>
                <p className="pcms-themeimport__hint">{t("themeImport.wizHomeHint")}</p>
                {wpImport.wizard.home.candidates.map((c) => (
                  <label key={c.stem} className="pcms-themeimport__wizrow">
                    <input
                      type="radio"
                      name="pcms-wiz-home"
                      checked={homeChoice === c.stem}
                      onChange={() => setHomeChoice(c.stem)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {wpImport.wizard.pages.length > 0 && (
              <fieldset className="pcms-themeimport__wiz">
                <legend>{t("themeImport.wizPages")}</legend>
                <p className="pcms-themeimport__hint">{t("themeImport.wizPagesHint")}</p>
                {wpImport.wizard.pages.map((p) => (
                  <label key={p.id} className="pcms-themeimport__wizrow">
                    <input
                      type="checkbox"
                      checked={includedPages[p.id] !== false}
                      onChange={(e) =>
                        setIncludedPages((prev) => ({ ...prev, [p.id]: e.target.checked }))
                      }
                    />
                    <span>
                      {p.title} <code>/{p.id}/</code>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {wpImport.wizard.unresolved.length > 0 && (
              <div className="pcms-themeimport__wizwarn" role="note">
                <strong>{t("themeImport.wizUnresolved")}</strong>
                <p className="pcms-themeimport__hint">{t("themeImport.wizUnresolvedHint")}</p>
                <ul>
                  {wpImport.wizard.unresolved.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </div>
            )}

            {wpImport.notes.length > 0 && (
              <ul className="pcms-themeimport__log">
                {wpImport.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <div className="pcms-themeimport__actions">
              <button
                className="pcms-primary"
                onClick={() => void importAsNewTheme()}
                disabled={saving || themeNameInput.trim() === ""}
              >
                {t("themeImport.asNewTheme")}
              </button>
              <button onClick={wpToBatch} disabled={saving}>
                {t("themeImport.addToCurrent")}
              </button>
            </div>
          </div>
        )}

        {renderedImport && (
          <div className="pcms-themeimport__wp">
            <h3>{t("themeImport.renderedTitle")}</h3>
            <p className="pcms-themeimport__hint">{t("themeImport.renderedDesc")}</p>
            <label className="pcms-themeimport__wpname">
              <span>{t("themeImport.newThemeName")}</span>
              <input
                type="text"
                value={themeNameInput}
                onChange={(e) => setThemeNameInput(e.target.value)}
                placeholder={renderedImport.name}
              />
            </label>
            {renderedImport.notes.length > 0 && (
              <ul className="pcms-themeimport__log">
                {renderedImport.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {api.fetchRenderedPage && renderedImport.baseUrl && (
              <div className="pcms-themeimport__pages">
                <h4>{t("themeImport.renderedPagesTitle")}</h4>
                <p className="pcms-themeimport__hint">{t("themeImport.renderedPagesHint")}</p>
                {candidatePages().length > 0 && (
                  <ul className="pcms-themeimport__pageslist">
                    {candidatePages().map((d) => (
                      <li key={d.slug}>
                        <label>
                          <input
                            type="checkbox"
                            checked={includedLinks[d.slug] !== false}
                            onChange={(e) =>
                              setIncludedLinks((m) => ({ ...m, [d.slug]: e.target.checked }))
                            }
                          />
                          <span className="pcms-themeimport__pagelabel">{d.label}</span>
                          <span className="pcms-themeimport__pageslug">/{d.slug}/</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="pcms-themeimport__addurl">
                  <input
                    type="url"
                    className="pcms-themeimport__url"
                    value={addUrl}
                    placeholder={t("themeImport.addUrlPlaceholder")}
                    onChange={(e) => setAddUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addManualUrl();
                      }
                    }}
                  />
                  <button type="button" onClick={addManualUrl} disabled={addUrl.trim() === ""}>
                    {t("themeImport.addUrl")}
                  </button>
                </div>
              </div>
            )}
            <div className="pcms-themeimport__actions">
              <button
                className="pcms-primary"
                onClick={() => void importRenderedAsNewTheme()}
                disabled={saving || themeNameInput.trim() === ""}
              >
                {saving ? t("themeImport.renderedImporting") : t("themeImport.asNewTheme")}
              </button>
            </div>
          </div>
        )}

        {batch && (
          <div className="pcms-themeimport__batch">
            <h3>{t("themeImport.batchTitle").replace("{count}", String(batch.length))}</h3>
            {zipNote && <p className="pcms-themeimport__hint">{zipNote}</p>}
            <ul className="pcms-themeimport__batchlist">
              {batch.map((it, i) => {
                const itErr = it.result.issues.some((iss) => iss.level === "error");
                return (
                  <li key={i} className={itErr ? "is-error" : undefined}>
                    <input
                      type="checkbox"
                      checked={it.include && !itErr}
                      disabled={itErr}
                      onChange={(e) => patchItem(i, { include: e.target.checked })}
                      aria-label={it.name}
                    />
                    <span className="pcms-themeimport__batchname">{it.name}</span>
                    <select
                      value={it.target}
                      onChange={(e) =>
                        patchItem(i, { target: e.target.value as "section" | "template" })
                      }
                      aria-label={t("themeImport.target")}
                    >
                      <option value="section">{t("themeImport.target.section")}</option>
                      <option value="template">{t("themeImport.target.template")}</option>
                    </select>
                    <input
                      type="text"
                      value={it.slug}
                      onChange={(e) => patchItem(i, { slug: slugify(e.target.value) })}
                      placeholder={t("themeImport.partName")}
                    />
                    {itErr && (
                      <span className="pcms-themeimport__batcherr">{t("themeImport.hasErrors")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="pcms-themeimport__actions">
              <button
                className="pcms-primary"
                onClick={() => void saveBatch()}
                disabled={
                  saving ||
                  batch.every(
                    (it) =>
                      !it.include ||
                      it.slug === "" ||
                      it.result.issues.some((iss) => iss.level === "error"),
                  )
                }
              >
                {t("themeImport.saveBatch")}
              </button>
            </div>
          </div>
        )}

        {!batch && result && (
          <div className="pcms-themeimport__result">
            <div className="pcms-themeimport__log">
              <h3>{t("themeImport.log")}</h3>
              <ul>
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              {diagnoses.length > 0 && (
                <ul className="pcms-themeimport__issues">
                  {diagnoses.map((d, i) => (
                    <li key={i} className={d.level === "error" ? "is-error" : "is-warning"}>
                      {d.message}
                      <span className="pcms-themeimport__fix">{d.fix}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pcms-themeimport__preview">
              <h3>{t("themeImport.preview")}</h3>
              <iframe
                className="pcms-themeimport__frame"
                srcDoc={previewDoc}
                sandbox=""
                title={t("themeImport.preview")}
              />
            </div>

            <div className="pcms-themeimport__save">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as "section" | "template")}
                aria-label={t("themeImport.target")}
              >
                <option value="section">{t("themeImport.target.section")}</option>
                <option value="template">{t("themeImport.target.template")}</option>
              </select>
              <input
                type="text"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder={t("themeImport.partName")}
              />
              <button
                className="pcms-primary"
                onClick={() => void save()}
                disabled={hasErrors || slug === "" || saving}
              >
                {t("themeImport.save")}
              </button>
            </div>
            {result.layout && (
              <label className="pcms-themeimport__layout">
                <input
                  type="checkbox"
                  checked={saveLayout}
                  onChange={(e) => setSaveLayout(e.target.checked)}
                />
                <span>{t("themeImport.saveLayout")}</span>
              </label>
            )}
            {hasErrors && <p className="pcms-themeimport__blocked">{t("themeImport.hasErrors")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
