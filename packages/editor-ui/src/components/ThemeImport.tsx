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
  localizeCssUrls,
  bytesToDataUrl,
  assetContentType,
  type ImportResult,
  type RenderedImportResult,
  type DiscoveredPage,
  type ImportSource,
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

const SOURCES: ImportSource[] = ["auto", "figma", "html", "other"];

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
 * Import a real site or HTML and reproduce it as a pcms theme: the high-fidelity
 * path folds a rendered page (from a URL, a saved "complete HTML" page, or pasted
 * source) + its CSS into a theme; a pasted HTML fragment is optimized into an
 * editable section. KUMITO reproduces HTML — it does not restore other platforms'
 * themes (a theme ZIP is a program, not a rendered page). CLAUDE.md: 元ファイル不変.
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
   * Import a ZIP made from HTML — a page saved as "complete HTML" (the .html plus
   * its CSS/images folder), zipped. We unzip in the browser, carry images/fonts as
   * data URLs, and reproduce the saved page as a theme (the same rendered path as a
   * URL import). A ZIP with no full HTML page falls back to the per-file section
   * import. KUMITO does not restore other platforms' themes. CLAUDE.md: 元ファイル不変.
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
    const notes: string[] = [];
    if (embedded > 0) notes.push(t("themeImport.zipImages").replace("{count}", String(embedded)));
    if (tooLarge > 0) {
      notes.push(
        t("themeImport.zipTooLarge")
          .replace("{count}", String(tooLarge))
          .replace("{limit}", `${ASSET_SIZE_CAP / 1024}KB`),
      );
    }

    // A saved "complete" page (rendered HTML + its CSS folder) is the design path —
    // fold it into one theme rather than splitting the archive into disconnected
    // parts. Pick the full HTML document (index first, then the largest).
    const rendered = Object.entries(entries)
      .filter(([p]) => /\.html?$/i.test(p))
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

    // No full page in the archive: treat each HTML/template file as a section to
    // import (a plain HTML import, not a theme restore).
    const items: BatchItem[] = [];
    for (const [path, bytes] of Object.entries(entries)) {
      if (/\/$/.test(path) || classifyZipEntry(path) !== "markup") continue;
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

    if (items.length === 0) {
      toast(t("themeImport.zipNoMarkup"));
      return;
    }
    setResult(null);
    setRaw("");
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
        {api.fetchRenderedPage && !batch && !renderedImport && (
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

        {!batch && !renderedImport && (
          <p className="pcms-themeimport__rendered-hint">{t("themeImport.renderedHint")}</p>
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
            accept=".html,.htm,.svg,.txt,.zip,text/html,image/svg+xml,application/zip"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
          <span className="pcms-themeimport__filehint">{t("themeImport.pickFileHint")}</span>
        </div>

        {!batch && !renderedImport && (
          <textarea
            className="pcms-themeimport__input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t("themeImport.paste")}
            rows={8}
          />
        )}

        {!batch && !renderedImport && (
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
