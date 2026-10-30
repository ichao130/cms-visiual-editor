import { useMemo, useRef, useState } from "react";
import { importThemeHtml, type ImportResult, type ImportSource } from "@pcms/engine";
import type { PcmsApi } from "../api/types.js";
import { useDialog } from "../state/useDialog.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

interface Props {
  api: PcmsApi;
  onClose: () => void;
}

const SOURCES: ImportSource[] = ["auto", "wordpress", "shopify", "html", "other"];

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
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setRaw(await file.text());
  };

  const aiFinish = async () => {
    if (!result) return;
    setAiBusy(true);
    try {
      const r = await api.aiThemeify(result.html);
      setResult({ html: r.html, issues: r.issues, notes: [...result.notes, "AIで仕上げました。"] });
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!result || hasErrors || slug === "") return;
    setSaving(true);
    try {
      const dir = target === "template" ? "templates" : "sections";
      await api.writeThemeFile(`${dir}/${slug}.html`, result.html);
      toast(t("themeImport.saved").replace("{name}", `${dir}/${slug}.html`));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const previewDoc = result
    ? `<!doctype html><html><head><meta charset="utf-8"><style>` +
      `body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;color:#1e1f22;line-height:1.6}` +
      `img{max-width:100%;height:auto}[data-section]{outline:1px dashed #c9deff;padding:8px;margin:8px 0}` +
      `</style></head><body>${result.html}</body></html>`
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
            accept=".html,.htm,.php,.liquid,.twig,.txt,text/html"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </div>

        <textarea
          className="pcms-themeimport__input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t("themeImport.paste")}
          rows={8}
        />

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

        {result && (
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
            {hasErrors && <p className="pcms-themeimport__blocked">{t("themeImport.hasErrors")}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
