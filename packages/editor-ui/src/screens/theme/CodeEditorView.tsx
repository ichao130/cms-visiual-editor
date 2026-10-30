import { useCallback, useEffect, useMemo, useState } from "react";
import { diagnoseThemeHtml, type AiDiagnosis } from "@pcms/engine";
import type { PcmsApi, ThemeFileKind, ThemeFileNode } from "../../api/types.js";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { CodeEditor } from "../../components/CodeEditor.js";
import { PartPreview } from "../../components/PartPreview.js";
import { t, type MessageKey } from "../../i18n.js";

interface Props {
  api: PcmsApi;
}

/** Starter templates offered when creating a new part. */
const PART_TEMPLATES: { id: string; label: MessageKey; make: (name: string) => string }[] = [
  {
    id: "basic",
    label: "code.tpl.basic",
    make: (n) =>
      `<section data-section="${n}" data-label="${n}">\n  <h2 data-field="heading" data-label="見出し">見出し</h2>\n  <p data-field="text" data-type="richtext" data-label="本文">本文をここに入力します。</p>\n</section>\n`,
  },
  {
    id: "image",
    label: "code.tpl.image",
    make: (n) =>
      `<section data-section="${n}" data-label="${n}">\n  <img data-field="image" data-label="画像" src="" alt="">\n  <h2 data-field="heading" data-label="見出し">見出し</h2>\n  <p data-field="text" data-type="richtext" data-label="本文">本文。</p>\n</section>\n`,
  },
  {
    id: "cta",
    label: "code.tpl.cta",
    make: (n) =>
      `<section data-section="${n}" data-label="${n}">\n  <h2 data-field="heading" data-label="見出し">見出し</h2>\n  <p data-field="lead" data-label="リード文">説明文をここに。</p>\n  <a data-field="cta_url" data-type="link" data-label="ボタンのリンク" href="#"><span data-field="cta_label" data-label="ボタンの文言">詳しく見る</span></a>\n</section>\n`,
  },
  {
    id: "cards",
    label: "code.tpl.cards",
    make: (n) =>
      `<section data-section="${n}" data-label="${n}">\n  <h2 data-field="heading" data-label="見出し">見出し</h2>\n  <div data-repeat="cards" data-label="カード">\n    <div>\n      <h3 data-field="title" data-label="タイトル">タイトル</h3>\n      <p data-field="body" data-label="本文">本文</p>\n    </div>\n  </div>\n</section>\n`,
  },
];

const safeName = (raw: string): string =>
  raw.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();

/** Diagnose the active file where we can (HTML parts/templates, theme.json). */
function validateFile(content: string, kind: ThemeFileKind | undefined): AiDiagnosis[] {
  if (kind === "html") return diagnoseThemeHtml(content);
  if (kind === "json") {
    try {
      JSON.parse(content);
    } catch (e) {
      return [{ level: "error", message: `JSON が不正です: ${(e as Error).message}`, fix: "" }];
    }
  }
  return [];
}

/**
 * VSCode-style code editor for theme development / part authoring. Edits a theme
 * working copy (never the original theme files — CLAUDE.md). Created parts can be
 * renamed/deleted; edited originals can be reverted; the whole working copy can
 * be reset back to the theme.
 */
export function CodeEditorView({ api }: Props) {
  const { reloadProject, project } = useSiteWorkspace();
  const [files, setFiles] = useState<ThemeFileNode[]>([]);
  const [showPreview, setShowPreview] = useState(true);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [newTemplate, setNewTemplate] = useState<string>(PART_TEMPLATES[0]!.id);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);

  // The active node is derived from the current list, so its custom/edited flags
  // stay correct after a save/delete/reset refresh.
  const active = files.find((f) => f.path === activePath) ?? null;
  const issues = useMemo(() => validateFile(content, active?.kind), [content, active?.kind]);
  const isSection = active?.kind === "html" && active.path.startsWith("sections/");

  const refreshFiles = useCallback(async () => {
    const list = await api.listThemeFiles();
    setFiles(list);
    return list;
  }, [api]);

  useEffect(() => {
    void refreshFiles().then((list) => {
      const first = list.find((f) => f.path === "layout.html") ?? list[0] ?? null;
      setActivePath(first?.path ?? null);
    });
  }, [refreshFiles]);

  useEffect(() => {
    if (!activePath) return;
    let ok = true;
    void api.readThemeFile(activePath).then((text) => {
      if (!ok) return;
      setContent(text);
      setDirty(false);
    });
    return () => {
      ok = false;
    };
  }, [api, activePath]);

  // Drop transient UI when switching files.
  useEffect(() => {
    setRename(null);
    setConfirm(null);
  }, [activePath]);

  const onSave = () => {
    if (!active) return;
    void api.writeThemeFile(active.path, content).then(() => {
      setDirty(false);
      void refreshFiles();
      reloadProject();
    });
  };

  const createPart = async () => {
    const safe = safeName(newName ?? "");
    if (!safe) {
      setNewName(null);
      return;
    }
    const path = `sections/${safe}.html`;
    const tpl = PART_TEMPLATES.find((p) => p.id === newTemplate) ?? PART_TEMPLATES[0]!;
    await api.writeThemeFile(path, tpl.make(safe));
    await refreshFiles();
    setActivePath(path);
    setNewName(null);
    reloadProject();
  };

  const doRename = async () => {
    if (!active || rename == null) return;
    const safe = safeName(rename);
    const to = `sections/${safe}.html`;
    if (!safe || to === active.path) {
      setRename(null);
      return;
    }
    await api.renameThemeFile(active.path, to);
    await refreshFiles();
    setActivePath(to);
    setRename(null);
    reloadProject();
  };

  const doDelete = async () => {
    if (!active) return;
    const wasPath = active.path;
    const wasCustom = active.custom;
    await api.deleteThemeFile(wasPath);
    const list = await refreshFiles();
    // A reverted original stays in the list (reload it); a deleted part is gone.
    const next = wasCustom
      ? (list.find((f) => f.path === "layout.html") ?? list[0] ?? null)
      : (list.find((f) => f.path === wasPath) ?? null);
    setActivePath(next?.path ?? null);
    // Reverting keeps the same path, so reload the content explicitly.
    setContent(next ? await api.readThemeFile(next.path) : "");
    setDirty(false);
    setConfirm(null);
    reloadProject();
  };

  const doReset = async () => {
    await api.resetTheme();
    const list = await refreshFiles();
    const next = list.find((f) => f.path === "layout.html") ?? list[0] ?? null;
    setActivePath(next?.path ?? null);
    setContent(next ? await api.readThemeFile(next.path) : "");
    setDirty(false);
    setConfirm(null);
    reloadProject();
  };

  const grouped = groupByDir(files);

  return (
    <div className="pcms-codelayout">
      <aside className="pcms-filetree">
        <div className="pcms-filetree__head">
          <span>{t("code.files")}</span>
          <button
            className="pcms-filetree__new"
            onClick={() => setNewName((v) => (v == null ? "" : null))}
            title={t("code.newPart")}
          >
            ＋
          </button>
        </div>
        {newName != null && (
          <div className="pcms-filetree__newbox">
            <div className="pcms-filetree__newrow">
              <input
                autoFocus
                className="pcms-filetree__newinput"
                value={newName}
                placeholder={t("code.newPartPlaceholder")}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createPart();
                  else if (e.key === "Escape") setNewName(null);
                }}
              />
              <button className="pcms-primary" onClick={() => void createPart()}>
                {t("code.create")}
              </button>
            </div>
            <select
              className="pcms-filetree__tplselect"
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
            >
              {PART_TEMPLATES.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </div>
        )}
        {grouped.map(([dir, nodes]) => (
          <div key={dir} className="pcms-filetree__group">
            {dir && <div className="pcms-filetree__dir">{dir}/</div>}
            {nodes.map((f) => (
              <button
                key={f.path}
                className={`pcms-filetree__file${active?.path === f.path ? " is-active" : ""}`}
                onClick={() => setActivePath(f.path)}
                style={{ paddingLeft: dir ? "1.4rem" : "0.6rem" }}
              >
                <span className="pcms-filetree__name">{basename(f.path)}</span>
                {f.custom && <span className="pcms-filetree__tag is-new">{t("code.tag.new")}</span>}
                {f.edited && <span className="pcms-filetree__tag is-edited">{t("code.tag.edited")}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="pcms-filetree__foot">
          {confirm === "reset" ? (
            <div className="pcms-confirm">
              <span>{t("code.resetConfirm")}</span>
              <div className="pcms-confirm__actions">
                <button className="pcms-danger" onClick={() => void doReset()}>
                  {t("common.yes")}
                </button>
                <button onClick={() => setConfirm(null)}>{t("common.no")}</button>
              </div>
            </div>
          ) : (
            <button className="pcms-filetree__reset" onClick={() => setConfirm("reset")}>
              {t("code.reset")}
            </button>
          )}
        </div>
      </aside>

      <div className="pcms-codemain">
        <div className="pcms-codemain__bar">
          {rename != null ? (
            <div className="pcms-codemain__rename">
              <input
                autoFocus
                className="pcms-filetree__newinput"
                value={rename}
                placeholder={t("code.renamePlaceholder")}
                onChange={(e) => setRename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doRename();
                  else if (e.key === "Escape") setRename(null);
                }}
              />
              <button className="pcms-primary" onClick={() => void doRename()}>
                {t("code.rename")}
              </button>
              <button onClick={() => setRename(null)}>{t("common.no")}</button>
            </div>
          ) : confirm === "delete" ? (
            <div className="pcms-codemain__rename">
              <span>{t("code.deleteConfirm")}</span>
              <button className="pcms-danger" onClick={() => void doDelete()}>
                {t("common.yes")}
              </button>
              <button onClick={() => setConfirm(null)}>{t("common.no")}</button>
            </div>
          ) : (
            <>
              <span className="pcms-codemain__path">{active?.path ?? ""}</span>
              <div className="pcms-codemain__actions">
                {active?.custom && (
                  <>
                    <button onClick={() => setRename(baseNoExt(active.path))}>
                      {t("code.rename")}
                    </button>
                    <button className="pcms-danger" onClick={() => setConfirm("delete")}>
                      {t("code.delete")}
                    </button>
                  </>
                )}
                {active?.edited && (
                  <button onClick={() => void doDelete()}>{t("code.revert")}</button>
                )}
                {isSection && (
                  <button
                    className={showPreview ? "is-active" : ""}
                    onClick={() => setShowPreview((v) => !v)}
                  >
                    {t("code.preview")}
                  </button>
                )}
                <button className="pcms-primary" onClick={onSave} disabled={!active || !dirty}>
                  {dirty ? t("common.save") : t("common.saved")}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="pcms-codemain__split">
          <div className="pcms-codemain__editorcol">
            {active ? (
              <CodeEditor
                key={active.path}
                value={content}
                kind={active.kind}
                onChange={(v) => {
                  setContent(v);
                  setDirty(true);
                }}
              />
            ) : (
              <p className="pcms-empty">{t("code.pickHint")}</p>
            )}
            {active && (
              <div className={`pcms-codeissues${issues.length ? " has-issues" : ""}`}>
                {issues.length === 0 ? (
                  <span className="pcms-codeissues__ok">✓ {t("code.validOk")}</span>
                ) : (
                  issues.map((iss, i) => (
                    <span key={i} className={`pcms-codeissues__item is-${iss.level}`}>
                      {iss.level === "error" ? "⛔" : "⚠️"} {iss.message}
                      {iss.fix ? <em className="pcms-codeissues__fix">{iss.fix}</em> : null}
                    </span>
                  ))
                )}
              </div>
            )}
          </div>
          {isSection && showPreview && (
            <div className="pcms-partpreview">
              <div className="pcms-partpreview__head">{t("code.preview")}</div>
              <PartPreview html={content} css={project.previewCss} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function baseNoExt(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "");
}

function groupByDir(files: ThemeFileNode[]): [string, ThemeFileNode[]][] {
  const map = new Map<string, ThemeFileNode[]>();
  for (const f of files) {
    const i = f.path.lastIndexOf("/");
    const dir = i < 0 ? "" : f.path.slice(0, i);
    const list = map.get(dir) ?? [];
    list.push(f);
    map.set(dir, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
