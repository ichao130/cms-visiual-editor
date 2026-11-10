import { useMemo, useRef, useState, type DragEvent } from "react";
import { unzipSync } from "fflate";
import { Icon } from "./Icon.js";
import {
  importThemeHtml,
  suggestThemePart,
  diagnoseThemeHtml,
  classifyZipEntry,
  inlineThemeAssets,
  detectWpThemeKind,
  importWpTheme,
  localizeCssUrls,
  bytesToDataUrl,
  assetContentType,
  type ImportResult,
  type ImportSource,
  type WpImportFile,
  type WpImportResult,
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
  const [themeNameInput, setThemeNameInput] = useState("");
  const [zipNote, setZipNote] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const hasErrors = errors.length > 0;
  const slug = useMemo(() => slugify(partName), [partName]);
  const diagnoses = useMemo(() => (result ? diagnoseThemeHtml(result.html) : []), [result]);

  const convert = () => {
    if (raw.trim() === "") return;
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
      const wpCss =
        refced.length > 0
          ? refced.map((x) => `/* ${x.b} */\n${x.text}`).join("\n\n")
          : cssText;
      const files = buildWpThemeFiles(wp, wpCss, assets, jsAssets);
      const name = readWpThemeName(wp.files["theme.json"]) ?? baseName(file.name).replace(/\.zip$/i, "");
      const wpNotes = [...notes, ...wp.notes];
      const jsCount = Object.keys(jsAssets).length;
      if (jsCount > 0) wpNotes.push(t("themeImport.wpJs").replace("{count}", String(jsCount)));
      setResult(null);
      setRaw("");
      setBatch(null);
      setZipNote(notes.join(" "));
      setThemeNameInput(name);
      setWpImport({ name, kind: wpKind, files, notes: wpNotes, fallbackBatch: items });
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
    // A single file falls back to the paste flow (preview + manual save).
    if (list.length === 1 && list[0]) {
      setBatch(null);
      setWpImport(null);
      setZipNote(null);
      setResult(null);
      const only = list[0];
      setRaw(await only.text());
      const s = suggestThemePart(only.name);
      if (s.slug) setPartName(s.slug);
      setTarget(s.target);
      return;
    }
    // Several files: import each and queue them for one batched save.
    const items: BatchItem[] = [];
    for (const file of list) {
      const r = importThemeHtml(await file.text());
      const s = suggestThemePart(file.name);
      items.push({
        name: file.name,
        result: r,
        slug: s.slug || slugify(file.name),
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
      const summary = await api.createTheme(
        { name, source: source === "auto" ? "wordpress" : source },
        wpImport.files,
      );
      await api.setActiveTheme(summary.id);
      toast(t("themeImport.importedAsTheme").replace("{name}", name));
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

        {!batch && !wpImport && (
          <textarea
            className="pcms-themeimport__input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t("themeImport.paste")}
            rows={8}
          />
        )}

        {!batch && !wpImport && (
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
