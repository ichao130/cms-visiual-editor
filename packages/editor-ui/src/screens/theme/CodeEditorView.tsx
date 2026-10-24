import { useCallback, useEffect, useState } from "react";
import type { PcmsApi, ThemeFileNode } from "../../api/types.js";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { CodeEditor } from "../../components/CodeEditor.js";
import { t } from "../../i18n.js";

interface Props {
  api: PcmsApi;
}

const NEW_PART_TEMPLATE = (name: string) =>
  `<section data-section="${name}" data-label="${name}">
  <h2 data-field="heading" data-label="見出し">見出し</h2>
  <p data-field="text" data-type="richtext" data-label="本文">本文をここに入力します。</p>
</section>
`;

const safeName = (raw: string): string =>
  raw.trim().replace(/[^a-z0-9-]/gi, "-").toLowerCase();

/**
 * VSCode-style code editor for theme development / part authoring. Edits a theme
 * working copy (never the original theme files — CLAUDE.md). Created parts can be
 * renamed/deleted; edited originals can be reverted; the whole working copy can
 * be reset back to the theme.
 */
export function CodeEditorView({ api }: Props) {
  const { reloadProject } = useSiteWorkspace();
  const [files, setFiles] = useState<ThemeFileNode[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);

  // The active node is derived from the current list, so its custom/edited flags
  // stay correct after a save/delete/reset refresh.
  const active = files.find((f) => f.path === activePath) ?? null;

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
    await api.writeThemeFile(path, NEW_PART_TEMPLATE(safe));
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
                <button className="pcms-primary" onClick={onSave} disabled={!active || !dirty}>
                  {dirty ? t("common.save") : t("common.saved")}
                </button>
              </div>
            </>
          )}
        </div>
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
