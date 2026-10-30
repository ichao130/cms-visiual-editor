import { useMemo, useRef, useState } from "react";
import {
  importThemeHtml,
  suggestThemePart,
  type ImportResult,
  type ImportSource,
} from "@pcms/engine";
import type { PcmsApi } from "../api/types.js";
import { useDialog } from "../state/useDialog.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  onClose: () => void;
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

/**
 * Import an external theme/template (WordPress, Shopify, any HTML) and optimize
 * it into a pcms theme fragment: strip server/template code and scripts, add
 * editable data-* annotations, validate, preview, then save it as a reusable
 * section in the theme working copy. CLAUDE.md: テーマ元ファイルは不変 / 人が適用を選ぶ.
 */
export function ThemeImport({ api, onClose }: Props) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const toast = useToast();
  const [raw, setRaw] = useState("");
  const [source, setSource] = useState<ImportSource>("auto");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [partName, setPartName] = useState("");
  const [target, setTarget] = useState<"section" | "template">("section");
  const [saveLayout, setSaveLayout] = useState(true);
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const errors = result?.issues.filter((i) => i.level === "error") ?? [];
  const hasErrors = errors.length > 0;
  const slug = useMemo(() => slugify(partName), [partName]);

  const convert = () => {
    if (raw.trim() === "") return;
    const r = importThemeHtml(raw);
    if (source !== "auto") {
      r.notes = [`${t(`themeImport.source.${source}` as never)}として取り込みました。`, ...r.notes];
    }
    setResult(r);
  };

  const onPickFile = () => fileRef.current?.click();
  const onFiles = async (files: FileList | null) => {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;
    // A single file falls back to the paste flow (preview + manual save).
    if (list.length === 1 && list[0]) {
      setBatch(null);
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
      <div className="pcms-modal__panel pcms-modal__panel--wide" ref={ref} tabIndex={-1}>
        <header className="pcms-modal__head">
          <h2>{t("themeImport.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            ✕
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
            accept=".html,.htm,.php,.liquid,.twig,.svg,.txt,text/html,image/svg+xml"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
        </div>

        {!batch && (
          <textarea
            className="pcms-themeimport__input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t("themeImport.paste")}
            rows={8}
          />
        )}

        {!batch && (
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

        {batch && (
          <div className="pcms-themeimport__batch">
            <h3>{t("themeImport.batchTitle").replace("{count}", String(batch.length))}</h3>
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
              {result.issues.length > 0 && (
                <ul className="pcms-themeimport__issues">
                  {result.issues.map((iss, i) => (
                    <li key={i} className={iss.level === "error" ? "is-error" : "is-warning"}>
                      {iss.message}
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
