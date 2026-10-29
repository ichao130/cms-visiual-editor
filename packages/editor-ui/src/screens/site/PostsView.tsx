import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { createContent, slugExists } from "../../state/editorState.js";
import { NewContentModal } from "../../components/NewContentModal.js";
import { ContentEditorPanel } from "./ContentEditorPanel.js";
import { t } from "../../i18n.js";

/** Posts (and custom post types). Pages live in their own view. */
export function PostsView() {
  const { doc, commit, setDirty } = useSiteWorkspace();
  const [selected, setSelected] = useState<{ type: string; slug: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "published" | "draft">("all");

  const postTypes = doc.contentTypes.filter((tp) => tp.name !== "page");
  const q = query.trim().toLowerCase();
  const filtering = q !== "" || status !== "all";
  const posts = doc.content.filter((i) => {
    if (i.type === "page") return false;
    const itemStatus = i.status ?? "published";
    if (status !== "all" && itemStatus !== status) return false;
    if (!q) return true;
    const title = String(i.fields.title ?? "").toLowerCase();
    return title.includes(q) || i.slug.toLowerCase().includes(q);
  });
  const matchCount = posts.length;

  const onCreate = (type: string, title: string, slug: string) => {
    let unique = slug;
    let n = 2;
    while (slugExists(doc, type, unique)) unique = `${slug}-${n++}`;
    commit(createContent(doc, type, title, unique));
    setDirty(true);
    setNewOpen(false);
    setSelected({ type, slug: unique });
  };

  return (
    <div className="pcms-contentpane">
      <div className="pcms-contentpane__list">
        <div className="pcms-listhead">
          <h1 className="pcms-page__title">{t("site.tab.posts")}</h1>
          <div className="pcms-listhead__actions">
            <button className="pcms-primary" onClick={() => setNewOpen(true)}>
              ＋ {t("content.new")}
            </button>
          </div>
        </div>

        <div className="pcms-listsearch">
          <input
            type="search"
            className="pcms-listsearch__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("content.search")}
          />
          <select
            className="pcms-listsearch__status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "all" | "published" | "draft")}
            aria-label={t("content.status")}
          >
            <option value="all">{t("content.status.all")}</option>
            <option value="published">{t("content.status.published")}</option>
            <option value="draft">{t("content.status.draft")}</option>
          </select>
          {filtering && (
            <span className="pcms-listsearch__count">
              {t("content.matchCount").replace("{count}", String(matchCount))}
            </span>
          )}
        </div>

        {filtering && matchCount === 0 ? (
          <p className="pcms-empty">{t("content.noMatch")}</p>
        ) : null}

        {postTypes.map((tp) => {
          const items = posts.filter((i) => i.type === tp.name);
          // While filtering, hide type groups that have no match.
          if (filtering && items.length === 0) return null;
          return (
            <div key={tp.name} className="pcms-typegroup">
              <h2 className="pcms-typegroup__title">{tp.label ?? tp.name}</h2>
              {items.length === 0 ? (
                <p className="pcms-empty">{t("content.none")}</p>
              ) : (
                <ul className="pcms-itemlist">
                  {items.map((i) => (
                    <li key={`${i.type}/${i.slug}`}>
                      <button
                        className={`pcms-itemlist__row${
                          selected?.type === i.type && selected?.slug === i.slug ? " is-selected" : ""
                        }`}
                        onClick={() => setSelected({ type: i.type, slug: i.slug })}
                      >
                        <span className="pcms-itemlist__title">
                          {String(i.fields.title ?? i.slug)}
                          {i.status === "draft" && (
                            <span className="pcms-draftbadge">{t("content.status.draft")}</span>
                          )}
                        </span>
                        <span className="pcms-itemlist__slug">/{i.slug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="pcms-contentpane__editor">
        {selected ? (
          <ContentEditorPanel
            type={selected.type}
            slug={selected.slug}
            onDeleted={() => setSelected(null)}
            onDuplicated={(type, slug) => setSelected({ type, slug })}
          />
        ) : (
          <aside className="pcms-settings">
            <p className="pcms-empty">{t("content.pickHint")}</p>
          </aside>
        )}
      </div>

      {newOpen && (
        <NewContentModal
          types={postTypes}
          onCreate={onCreate}
          onClose={() => setNewOpen(false)}
        />
      )}
    </div>
  );
}
