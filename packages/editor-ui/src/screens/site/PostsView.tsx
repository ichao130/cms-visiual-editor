import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { createContent, slugExists } from "../../state/editorState.js";
import { NewContentModal } from "../../components/NewContentModal.js";
import { ContentEditorPanel } from "./ContentEditorPanel.js";
import { t } from "../../i18n.js";

/** Posts (and custom post types). Pages live in their own view. */
export function PostsView() {
  const { doc, commit, setDirty, dirty, save } = useSiteWorkspace();
  const [selected, setSelected] = useState<{ type: string; slug: string } | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const postTypes = doc.contentTypes.filter((tp) => tp.name !== "page");
  const posts = doc.content.filter((i) => i.type !== "page");

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
            <button onClick={save} disabled={!dirty}>
              {dirty ? t("common.save") : t("common.saved")}
            </button>
          </div>
        </div>

        {postTypes.map((tp) => {
          const items = posts.filter((i) => i.type === tp.name);
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
