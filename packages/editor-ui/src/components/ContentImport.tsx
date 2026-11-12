import { useRef, useState, type DragEvent } from "react";
import { Icon } from "./Icon.js";
import { parseWxr, type WxrImportResult, type WxrImportItem } from "@pcms/engine";
import type { ContentItem } from "@pcms/shared";
import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

interface Props {
  onClose: () => void;
}

const keyOf = (i: WxrImportItem): string => `${i.item.type}/${i.item.slug}`;

/** Unique slug within a growing `type/slug` set (mirrors editorState.uniqueSlug). */
function uniqueIn(used: Set<string>, type: string, base: string): string {
  let slug = base;
  let n = 2;
  while (used.has(`${type}/${slug}`)) slug = `${base}-${n++}`;
  used.add(`${type}/${slug}`);
  return slug;
}

/**
 * WXR (WordPress export) content import. A theme ZIP carries no content — the
 * real pages/posts live in the WP database — so this brings them in from a
 * Tools → Export XML file as pcms content items. The front page's body is flowed
 * into the active theme's top (settings.pages.index の本文スロット post.body), per
 * the owner's chosen behaviour; images that reference the old site are flagged.
 */
export function ContentImport({ onClose }: Props) {
  const { doc, commit, setDirty } = useSiteWorkspace();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<WxrImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [flowHome, setFlowHome] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");

  const readFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const r = parseWxr(text);
      if (r.items.length === 0 && !r.home) {
        setError(t("contentImport.empty"));
        return;
      }
      setError("");
      setResult(r);
      setFileName(file.name);
      setInclude(new Set(r.items.map(keyOf)));
    } catch {
      setError(t("contentImport.readError"));
    }
  };

  const onFiles = (files: FileList | null): void => {
    const f = files?.[0];
    if (f) void readFile(f);
  };

  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes("Files");
  const onDragOver = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (e: DragEvent): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };
  const onDrop = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragOver(false);
    onFiles(e.dataTransfer.files);
  };

  const toggle = (k: string): void => {
    setInclude((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const doImport = (): void => {
    if (!result) return;
    const chosen = result.items.filter((i) => include.has(keyOf(i)));

    // Assign unique slugs against existing + newly-added content, and remap page
    // slugs so parent references stay valid after any rename.
    const used = new Set(doc.content.map((i) => `${i.type}/${i.slug}`));
    const pageRemap = new Map<string, string>(); // original page slug → final slug
    const finalSlugs = new Map<WxrImportItem, string>();
    for (const wi of chosen) {
      const finalSlug = uniqueIn(used, wi.item.type, wi.item.slug);
      finalSlugs.set(wi, finalSlug);
      if (wi.item.type === "page") pageRemap.set(wi.item.slug, finalSlug);
    }
    const added: ContentItem[] = chosen.map((wi) => {
      const slug = finalSlugs.get(wi)!;
      const parent = wi.item.parent ? (pageRemap.get(wi.item.parent) ?? wi.item.parent) : undefined;
      return parent ? { ...wi.item, slug, parent } : { ...wi.item, slug };
    });

    let settings = doc.settings;
    let homed = false;
    if (flowHome && result.home) {
      const index = settings.pages.index ?? {};
      settings = {
        ...settings,
        pages: {
          ...settings.pages,
          index: { ...index, fields: { ...(index.fields ?? {}), "post.body": result.home.html } },
        },
      };
      homed = true;
    }

    commit({ ...doc, content: [...doc.content, ...added], settings });
    setDirty(true);
    const parts = [t("contentImport.done").replace("{count}", String(added.length))];
    if (homed) parts.push(t("contentImport.doneHome"));
    toast(parts.join(" "));
    onClose();
  };

  const counts = result
    ? {
        pages: result.items.filter((i) => i.item.type === "page").length,
        posts: result.items.filter((i) => i.item.type === "post").length,
      }
    : { pages: 0, posts: 0 };

  return (
    <div className="pcms-modal" role="dialog" aria-modal="true" aria-label={t("contentImport.title")}>
      <div className="pcms-modal__backdrop" onClick={onClose} />
      <div
        className={`pcms-modal__panel pcms-modal__panel--wide${dragOver ? " is-dragover" : ""}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="pcms-themeimport__dropzone" aria-hidden="true">
            <Icon name="folder" size={28} />
            <span>{t("contentImport.dropHint")}</span>
          </div>
        )}
        <header className="pcms-modal__head">
          <h2>{t("contentImport.title")}</h2>
          <div className="pcms-modal__spacer" />
          <button type="button" onClick={onClose} aria-label={t("media.close")}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="pcms-themeimport__hint">{t("contentImport.hint")}</p>

        <div className="pcms-themeimport__controls">
          <button type="button" onClick={() => fileRef.current?.click()}>
            {t("contentImport.pickFile")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            hidden
            onChange={(e) => onFiles(e.target.files)}
          />
          <span className="pcms-themeimport__filehint">
            {fileName || t("contentImport.pickFileHint")}
          </span>
        </div>

        {error && <p className="pcms-contentimport__error">{error}</p>}

        {result && (
          <div className="pcms-contentimport__result">
            <p className="pcms-contentimport__summary">
              {t("contentImport.summary")
                .replace("{pages}", String(counts.pages))
                .replace("{posts}", String(counts.posts))}
            </p>

            {result.home && (
              <label className="pcms-themeimport__wizrow">
                <input
                  type="checkbox"
                  checked={flowHome}
                  onChange={(e) => setFlowHome(e.target.checked)}
                />
                <span>{t("contentImport.flowHome").replace("{title}", result.home.title)}</span>
              </label>
            )}

            {result.items.length > 0 && (
              <fieldset className="pcms-themeimport__wiz">
                <legend>{t("contentImport.items")}</legend>
                <ul className="pcms-contentimport__list">
                  {result.items.map((wi) => {
                    const k = keyOf(wi);
                    return (
                      <li key={k} className="pcms-themeimport__wizrow">
                        <label>
                          <input
                            type="checkbox"
                            checked={include.has(k)}
                            onChange={() => toggle(k)}
                          />
                          <span className="pcms-contentimport__kind">
                            {wi.item.type === "page"
                              ? t("contentImport.kind.page")
                              : t("contentImport.kind.post")}
                          </span>
                          <span className="pcms-contentimport__title">
                            {String(wi.item.fields.title ?? wi.item.slug)}
                          </span>
                          <span className="pcms-contentimport__slug">/{wi.item.slug}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}

            {result.unresolvedImages.length > 0 && (
              <div className="pcms-themeimport__wizwarn">
                <strong>{t("contentImport.imagesTitle")}</strong>
                <p>
                  {t("contentImport.imagesHint").replace(
                    "{count}",
                    String(result.unresolvedImages.length),
                  )}
                </p>
              </div>
            )}

            <div className="pcms-themeimport__actions">
              <button
                type="button"
                className="pcms-primary"
                disabled={include.size === 0 && !(flowHome && result.home)}
                onClick={doImport}
              >
                {t("contentImport.run")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
