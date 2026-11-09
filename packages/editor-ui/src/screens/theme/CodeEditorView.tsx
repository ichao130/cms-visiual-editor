import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blockPartTemplate, diagnoseThemeHtml, type AiDiagnosis } from "@pcms/engine";
import type { PcmsApi, ThemeFileKind, ThemeFileNode } from "../../api/types.js";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { CodeEditor } from "../../components/CodeEditor.js";
import { cssVarNames } from "../../components/code-complete.js";
import { PartPreview } from "../../components/PartPreview.js";
import { t, type MessageKey } from "../../i18n.js";
import { Icon } from "../../components/Icon.js";

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

/** Starter for a new page template (templates/<name>.html). */
const TEMPLATE_STARTER =
  `<article class="entry">\n  <h1 data-field="post.title">タイトル</h1>\n  <div data-field="post.body" data-type="richtext"></div>\n</article>\n`;

const safeName = (raw: string): string =>
  raw.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();

/** Asset filenames keep a single dot + extension (e.g. "bg-pattern.png"). */
const safeAssetName = (raw: string): string => {
  const cleaned = raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return cleaned.replace(/\./g, "-");
  const stem = cleaned.slice(0, dot).replace(/\./g, "-");
  const ext = cleaned.slice(dot + 1).replace(/[^a-z0-9]/g, "");
  return ext ? `${stem}.${ext}` : stem;
};

/** Starter content for a newly created text asset, chosen by extension. */
const assetStarter = (path: string): string => {
  if (path.endsWith(".css")) return "/* カスタムスタイル */\n";
  if (path.endsWith(".js")) return "// カスタムスクリプト\n";
  if (path.endsWith(".html")) return "<div>\n</div>\n";
  if (path.endsWith(".svg"))
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>\n';
  return "";
};

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
  if (kind === "css") {
    const open = (content.match(/\{/g) ?? []).length;
    const close = (content.match(/\}/g) ?? []).length;
    if (open !== close) {
      return [
        {
          level: "warning",
          message: `波括弧 { } の数が合っていません（{ が ${open} 個、} が ${close} 個）`,
          fix: "ルールの開き括弧と閉じ括弧の対応を確認してください。",
        },
      ];
    }
  }
  if (kind === "js") return diagnoseJs(content);
  return [];
}

/**
 * Lightweight JS bracket-balance check (no eval, so it is CSP-safe and never
 * fails on module syntax). Ignores brackets inside strings, template literals,
 * and comments so quoted braces don't trip it.
 */
function diagnoseJs(code: string): AiDiagnosis[] {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  let i = 0;
  let inStr: string | null = null;
  while (i < code.length) {
    const ch = code[i]!;
    const next = code[i + 1];
    if (inStr) {
      if (ch === "\\") i += 2;
      else {
        if (ch === inStr) inStr = null;
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = code.indexOf("\n", i);
      i = nl < 0 ? code.length : nl;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end < 0 ? code.length : end + 2;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (stack.pop() !== pairs[ch]) {
        return [{
          level: "warning",
          message: `括弧の対応が取れていません（${ch} の位置）`,
          fix: "( ) [ ] { } の開き・閉じの対応を確認してください。",
        }];
      }
    }
    i += 1;
  }
  if (inStr) {
    return [{ level: "warning", message: "文字列が閉じていません", fix: "引用符の閉じ忘れを確認してください。" }];
  }
  if (stack.length > 0) {
    return [{
      level: "warning",
      message: `閉じられていない括弧が ${stack.length} 個あります`,
      fix: "( [ { に対応する閉じ括弧を確認してください。",
    }];
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
  const [newKind, setNewKind] = useState<"section" | "block" | "template" | "asset">("section");
  const [filter, setFilter] = useState("");
  const [newTemplate, setNewTemplate] = useState<string>(PART_TEMPLATES[0]!.id);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "remove" | "reset" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Right-click context menu on a file-tree entry.
  const [menu, setMenu] = useState<{ x: number; y: number; file: ThemeFileNode } | null>(null);
  // Collapsed directory groups in the file tree (an imported theme can ship
  // dozens of asset files, so each folder can be folded away).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);

  const toggleDir = (dir: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  // The active node is derived from the current list, so its custom/edited flags
  // stay correct after a save/delete/reset refresh.
  const active = files.find((f) => f.path === activePath) ?? null;
  const issues = useMemo(() => validateFile(content, active?.kind), [content, active?.kind]);
  // CSS variables the theme defines, so the editor can suggest `var(--…)`.
  const cssVars = useMemo(() => cssVarNames(project.previewCss ?? ""), [project.previewCss]);
  const isSection = active?.kind === "html" && active.path.startsWith("sections/");
  const isAsset = active?.path.startsWith("assets/") ?? false;

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

  // Close the context menu on Escape (outside clicks are caught by its scrim).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const onSave = () => {
    if (!active) return;
    void api.writeThemeFile(active.path, content).then(() => {
      setDirty(false);
      void refreshFiles();
      reloadProject();
    });
  };

  const createPart = async () => {
    if (newKind === "asset") {
      const safe = safeAssetName(newName ?? "");
      if (!safe) {
        setNewName(null);
        return;
      }
      const path = `assets/${safe}`;
      await api.writeThemeFile(path, assetStarter(path));
      await refreshFiles();
      setActivePath(path);
      setNewName(null);
      reloadProject();
      return;
    }
    const safe = safeName(newName ?? "");
    if (!safe) {
      setNewName(null);
      return;
    }
    const path =
      newKind === "block"
        ? `blocks/${safe}.html`
        : newKind === "template"
          ? `templates/${safe}.html`
          : `sections/${safe}.html`;
    const content =
      newKind === "block"
        ? blockPartTemplate(safe, safe)
        : newKind === "template"
          ? TEMPLATE_STARTER
          : (PART_TEMPLATES.find((p) => p.id === newTemplate) ?? PART_TEMPLATES[0]!).make(safe);
    await api.writeThemeFile(path, content);
    await refreshFiles();
    setActivePath(path);
    setNewName(null);
    reloadProject();
  };

  /** Upload binary assets (images/fonts) into assets/ via the file picker. */
  const onUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    let last = "";
    for (const file of Array.from(list)) {
      const safe = safeAssetName(file.name);
      if (!safe) continue;
      const path = `assets/${safe}`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      await api.writeThemeAsset(path, bytes);
      last = path;
    }
    await refreshFiles();
    if (last) setActivePath(last);
    reloadProject();
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard unavailable — the path is still shown for manual copy */
    }
  };

  const doRename = async () => {
    if (!active || rename == null) return;
    // Rename within the file's own folder, keeping its extension (so blocks,
    // templates and assets rename in place, not only sections).
    const slash = active.path.lastIndexOf("/");
    const dir = slash < 0 ? "" : active.path.slice(0, slash);
    const dot = active.path.lastIndexOf(".");
    const ext = dot > slash ? active.path.slice(dot) : "";
    const safe = safeName(rename);
    const to = dir ? `${dir}/${safe}${ext}` : `${safe}${ext}`;
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

  const doDelete = async (target: ThemeFileNode | null = active) => {
    if (!target) return;
    const wasPath = target.path;
    const wasCustom = target.custom;
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

  /** Fully remove the active file (an original is tombstoned on the working copy;
   *  the theme's disk files are untouched, and resetTheme restores it). */
  const doRemove = async () => {
    if (!active) return;
    await api.removeThemeFile(active.path);
    const list = await refreshFiles();
    const next = list.find((f) => f.path === "layout.html") ?? list[0] ?? null;
    setActivePath(next?.path ?? null);
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

  const q = filter.trim().toLowerCase();
  const visibleFiles = q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  const grouped = groupByDir(visibleFiles);

  return (
    <div className="pcms-codelayout">
      <aside className="pcms-filetree">
        <div className="pcms-filetree__head">
          <span>{t("code.files")}</span>
          <div className="pcms-filetree__headbtns">
            <button
              className="pcms-filetree__new"
              onClick={() => fileInput.current?.click()}
              title={t("code.uploadAsset")}
            >
              <Icon name="media" size={16} />
            </button>
            <button
              className="pcms-filetree__new"
              onClick={() => setNewName((v) => (v == null ? "" : null))}
              title={t("code.newPart")}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,font/*,.woff,.woff2,.ttf,.otf"
            multiple
            hidden
            onChange={(e) => {
              void onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        <input
          type="search"
          className="pcms-filetree__search"
          value={filter}
          placeholder={t("code.search")}
          onChange={(e) => setFilter(e.target.value)}
        />
        {newName != null && (
          <div className="pcms-filetree__newbox">
            <div className="pcms-filetree__newrow">
              <input
                autoFocus
                className="pcms-filetree__newinput"
                value={newName}
                placeholder={
                  newKind === "asset"
                    ? t("code.newAssetPlaceholder")
                    : t("code.newPartPlaceholder")
                }
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
              value={newKind}
              onChange={(e) =>
                setNewKind(e.target.value as "section" | "block" | "template" | "asset")
              }
            >
              <option value="section">{t("code.kind.section")}</option>
              <option value="block">{t("code.kind.block")}</option>
              <option value="template">{t("code.kind.template")}</option>
              <option value="asset">{t("code.kind.asset")}</option>
            </select>
            {newKind === "section" && (
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
            )}
            {newKind === "asset" && (
              <p className="pcms-filetree__hint">{t("code.assetHint")}</p>
            )}
          </div>
        )}
        {grouped.map(([dir, nodes]) => {
          // While searching, keep every group open so matches are never hidden.
          const isCollapsed = dir !== "" && !q && collapsed.has(dir);
          return (
            <div key={dir} className="pcms-filetree__group">
              {dir && (
                <button
                  type="button"
                  className={`pcms-filetree__dir${isCollapsed ? " is-collapsed" : ""}`}
                  onClick={() => toggleDir(dir)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="pcms-filetree__diricon" aria-hidden="true">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="pcms-filetree__dirname">{dir}/</span>
                  <span className="pcms-filetree__dircount">{nodes.length}</span>
                </button>
              )}
              {!isCollapsed &&
                nodes.map((f) => (
                  <button
                    key={f.path}
                    className={`pcms-filetree__file${active?.path === f.path ? " is-active" : ""}`}
                    onClick={() => setActivePath(f.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setActivePath(f.path);
                      setMenu({ x: e.clientX, y: e.clientY, file: f });
                    }}
                    style={{ paddingLeft: dir ? "1.4rem" : "0.6rem" }}
                  >
                    <span className="pcms-filetree__name">{basename(f.path)}</span>
                    {f.custom && <span className="pcms-filetree__tag is-new">{t("code.tag.new")}</span>}
                    {f.edited && (
                      <span className="pcms-filetree__tag is-edited">{t("code.tag.edited")}</span>
                    )}
                  </button>
                ))}
            </div>
          );
        })}
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
          ) : confirm === "remove" ? (
            <div className="pcms-codemain__rename">
              <span>{t("code.removeConfirm")}</span>
              <button className="pcms-danger" onClick={() => void doRemove()}>
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
                {active && !active.custom && (
                  <button className="pcms-danger" onClick={() => setConfirm("remove")}>
                    {t("code.delete")}
                  </button>
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
            {!active ? (
              <p className="pcms-empty">{t("code.pickHint")}</p>
            ) : active.binary ? (
              <AssetInfo path={active.path} dataUrl={content} copied={copied} onCopy={copyText} />
            ) : (
              <>
                <CodeEditor
                  key={active.path}
                  value={content}
                  kind={active.kind}
                  cssVars={cssVars}
                  onChange={(v) => {
                    setContent(v);
                    setDirty(true);
                  }}
                />
                {isAsset && active.path !== "assets/style.css" && (
                  <AssetInfo path={active.path} copied={copied} onCopy={copyText} />
                )}
                <div className={`pcms-codeissues${issues.length ? " has-issues" : ""}`}>
                  {issues.length === 0 ? (
                    <span className="pcms-codeissues__ok"><Icon name="check" size={14} /> {t("code.validOk")}</span>
                  ) : (
                    issues.map((iss, i) => (
                      <span key={i} className={`pcms-codeissues__item is-${iss.level}`}>
                        {iss.level === "error" ? "⛔" : "⚠️"} {iss.message}
                        {iss.fix ? <em className="pcms-codeissues__fix">{iss.fix}</em> : null}
                      </span>
                    ))
                  )}
                </div>
              </>
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

      {menu && (
        <>
          <div
            className="pcms-ctxmenu__scrim"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="pcms-ctxmenu" style={{ top: menu.y, left: menu.x }} role="menu">
            {menu.file.custom && (
              <button
                onClick={() => {
                  setActivePath(menu.file.path);
                  setRename(baseNoExt(menu.file.path));
                  setMenu(null);
                }}
              >
                {t("code.rename")}
              </button>
            )}
            {menu.file.edited && (
              <button
                onClick={() => {
                  void doDelete(menu.file);
                  setMenu(null);
                }}
              >
                {t("code.revert")}
              </button>
            )}
            <button
              className="pcms-ctxmenu__danger"
              onClick={() => {
                setActivePath(menu.file.path);
                setConfirm(menu.file.custom ? "delete" : "remove");
                setMenu(null);
              }}
            >
              {t("code.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Shows an asset's reference paths (and, for an image, a preview) with copy
 * buttons — the operator asked to "get the path" for CSS backgrounds / HTML.
 */
function AssetInfo({
  path,
  dataUrl,
  copied,
  onCopy,
}: {
  path: string;
  dataUrl?: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const name = basename(path);
  const rows: { key: string; label: MessageKey; value: string }[] = [
    { key: "path", label: "code.asset.path", value: path },
    { key: "css", label: "code.asset.inCss", value: `url(${name})` },
    { key: "html", label: "code.asset.inHtml", value: `/${path}` },
  ];
  const isImage = typeof dataUrl === "string" && dataUrl.startsWith("data:image/");
  return (
    <div className="pcms-assetinfo">
      <div className="pcms-assetinfo__title">{t("code.asset.title")}</div>
      {dataUrl != null &&
        (isImage ? (
          <div className="pcms-assetinfo__preview">
            <img src={dataUrl} alt={name} />
          </div>
        ) : (
          <p className="pcms-assetinfo__hint">{t("code.asset.binaryHint")}</p>
        ))}
      {rows.map((r) => (
        <div key={r.key} className="pcms-assetinfo__row">
          <span className="pcms-assetinfo__label">{t(r.label)}</span>
          <code className="pcms-assetinfo__code">{r.value}</code>
          <button className="pcms-assetinfo__copy" onClick={() => onCopy(r.key, r.value)}>
            {copied === r.key ? t("code.asset.copied") : t("code.asset.copy")}
          </button>
        </div>
      ))}
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
