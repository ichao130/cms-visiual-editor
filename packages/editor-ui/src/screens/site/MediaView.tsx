import { useEffect, useState } from "react";
import type { MediaItem } from "@pcms/shared";
import { useMedia } from "../../media/MediaContext.js";
import { AltField, mediaMeta, unusedMedia } from "../../components/MediaLibrary.js";
import { t } from "../../i18n.js";

/** The selected folder view: everything, the unfiled root, or one folder. */
type FolderView = "all" | "root" | { name: string };

function folderOf(item: MediaItem): string {
  return item.folder ?? "";
}

/**
 * Full-page media manager: browse, import, and organize images into folders.
 * Folders are organizational only — an image's file name and output URL never
 * change, so moving it between folders never breaks a reference (CLAUDE.md:
 * 参照は壊さない). Picking an image while editing stays a separate dialog.
 */
export function MediaView() {
  const {
    media,
    folders,
    importing,
    usage,
    importInto,
    remove,
    removeMany,
    setAlt,
    setFolder,
    createFolder,
    deleteFolder,
    refreshUsage,
  } = useMedia();
  const [view, setView] = useState<FolderView>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  const currentFolder = typeof view === "object" ? view.name : view === "root" ? "" : null;
  const q = query.trim().toLowerCase();

  const inView = media.filter((m) => {
    if (view === "all") return true;
    return folderOf(m) === currentFolder;
  });
  const shown = q ? inView.filter((m) => m.fileName.toLowerCase().includes(q)) : inView;

  const countIn = (folder: string) => media.filter((m) => folderOf(m) === folder).length;
  const unused = unusedMedia(media, usage);

  const onNewFolder = () => {
    const name = window.prompt(t("media.newFolderPrompt"));
    if (name == null) return;
    const trimmed = name.trim();
    if (trimmed === "") return;
    void createFolder(trimmed).then(() => setView({ name: trimmed }));
  };

  const onDeleteFolder = (name: string) => {
    const msg = t("media.deleteFolderConfirm")
      .replace("{name}", name)
      .replace("{count}", String(countIn(name)));
    if (!window.confirm(msg)) return;
    void deleteFolder(name).then(() => setView("all"));
  };

  const onDeleteItem = (item: MediaItem) => {
    const used = usage[item.path] ?? 0;
    const msg =
      used > 0
        ? t("media.deleteUsedConfirm").replace("{name}", item.fileName).replace("{count}", String(used))
        : t("media.deleteConfirm").replace("{name}", item.fileName);
    if (window.confirm(msg)) void remove(item);
  };

  const onDeleteUnused = () => {
    if (unused.length === 0) return;
    const msg = t("media.deleteUnusedConfirm").replace("{count}", String(unused.length));
    if (window.confirm(msg)) void removeMany(unused);
  };

  return (
    <div className="pcms-mediaview">
      <div className="pcms-listhead">
        <h1 className="pcms-page__title">{t("site.tab.media")}</h1>
        <div className="pcms-listhead__actions">
          {unused.length > 0 && (
            <button type="button" className="pcms-danger" onClick={onDeleteUnused}>
              {t("media.deleteUnused").replace("{count}", String(unused.length))}
            </button>
          )}
          <button
            type="button"
            className="pcms-primary"
            disabled={importing}
            onClick={() => void importInto(currentFolder ?? "")}
          >
            {importing ? t("media.importing") : t("media.importHere")}
          </button>
        </div>
      </div>

      <div className="pcms-mediaview__body">
        <nav className="pcms-folders" aria-label={t("media.folders")}>
          <button
            type="button"
            className={`pcms-folders__item${view === "all" ? " is-active" : ""}`}
            onClick={() => setView("all")}
          >
            <span>{t("media.allItems")}</span>
            <span className="pcms-folders__count">{media.length}</span>
          </button>
          <button
            type="button"
            className={`pcms-folders__item${view === "root" ? " is-active" : ""}`}
            onClick={() => setView("root")}
          >
            <span>{t("media.unfiled")}</span>
            <span className="pcms-folders__count">{countIn("")}</span>
          </button>
          {folders.map((f) => (
            <div
              key={f}
              className={`pcms-folders__item${
                typeof view === "object" && view.name === f ? " is-active" : ""
              }`}
            >
              <button
                type="button"
                className="pcms-folders__name"
                onClick={() => setView({ name: f })}
              >
                📁 {f}
              </button>
              <span className="pcms-folders__count">{countIn(f)}</span>
              <button
                type="button"
                className="pcms-folders__del"
                aria-label={t("media.deleteFolder").replace("{name}", f)}
                title={t("media.deleteFolder").replace("{name}", f)}
                onClick={() => onDeleteFolder(f)}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="pcms-folders__add" onClick={onNewFolder}>
            ＋ {t("media.newFolder")}
          </button>
        </nav>

        <div className="pcms-mediaview__main">
          {media.length > 0 && (
            <input
              type="search"
              className="pcms-media__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("media.search")}
            />
          )}
          {shown.length === 0 ? (
            <p className="pcms-empty pcms-media__empty">
              {media.length === 0 ? t("media.empty") : t("media.noMatch")}
            </p>
          ) : (
            <ul className="pcms-media__grid">
              {shown.map((item) => (
                <li key={item.path} className="pcms-media__item">
                  <div className="pcms-media__pick pcms-media__thumb">
                    <img src={item.dataUrl} alt={item.fileName} />
                  </div>
                  <button
                    type="button"
                    className="pcms-media__delete"
                    onClick={() => onDeleteItem(item)}
                    aria-label={t("media.delete")}
                    title={t("media.delete")}
                  >
                    ✕
                  </button>
                  <span className="pcms-media__name">{item.fileName}</span>
                  {mediaMeta(item) && <span className="pcms-media__meta">{mediaMeta(item)}</span>}
                  <span
                    className={`pcms-media__usage${(usage[item.path] ?? 0) === 0 ? " is-unused" : ""}`}
                  >
                    {(usage[item.path] ?? 0) === 0
                      ? t("media.unused")
                      : t("media.usedCount").replace("{count}", String(usage[item.path]))}
                  </span>
                  <AltField item={item} onCommit={(alt) => void setAlt(item, alt)} />
                  <select
                    className="pcms-media__folderpick"
                    value={folderOf(item)}
                    aria-label={t("media.moveTo").replace("{name}", item.fileName)}
                    onChange={(e) => void setFolder(item, e.target.value)}
                  >
                    <option value="">{t("media.unfiled")}</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
