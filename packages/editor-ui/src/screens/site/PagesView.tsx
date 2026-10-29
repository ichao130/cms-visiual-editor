import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { createContent, slugExists } from "../../state/editorState.js";
import { NewContentModal } from "../../components/NewContentModal.js";
import { ContentEditorPanel } from "./ContentEditorPanel.js";
import { t } from "../../i18n.js";

const PAGE_TYPE = "page";

/** Fixed pages, shown and created as a hierarchy (parent/child). */
export function PagesView() {
  const { doc, commit, setDirty } = useSiteWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [query, setQuery] = useState("");

  const pages = doc.content.filter((i) => i.type === PAGE_TYPE);
  const childrenOf = (parent: string | undefined) =>
    pages.filter((p) => (p.parent ?? undefined) === parent);

  // While filtering, the parent/child tree is not useful, so show a flat list
  // of the pages whose title or slug matches.
  const q = query.trim().toLowerCase();
  const matches = pages.filter((p) => {
    const title = String(p.fields.title ?? "").toLowerCase();
    return title.includes(q) || p.slug.toLowerCase().includes(q);
  });

  const pageTypes = doc.contentTypes.filter((tp) => tp.name === PAGE_TYPE);

  const createPage = (title: string, slugBase: string, parent?: string) => {
    let slug = slugBase || "page";
    let n = 2;
    while (slugExists(doc, PAGE_TYPE, slug)) slug = `${slugBase || "page"}-${n++}`;
    let next = createContent(doc, PAGE_TYPE, title, slug);
    if (parent) {
      next = {
        ...next,
        content: next.content.map((i) =>
          i.type === PAGE_TYPE && i.slug === slug ? { ...i, parent } : i,
        ),
      };
    }
    commit(next);
    setDirty(true);
    setSelected(slug);
    setNewOpen(false);
  };

  const Tree = ({ parent, depth }: { parent: string | undefined; depth: number }) => (
    <>
      {childrenOf(parent).map((p) => (
        <div key={p.slug}>
          <div
            className={`pcms-tree__row${selected === p.slug ? " is-selected" : ""}`}
            style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }}
          >
            <button className="pcms-tree__label" onClick={() => setSelected(p.slug)}>
              {depth > 0 && <span className="pcms-tree__twig">└ </span>}
              {String(p.fields.title ?? p.slug)}
              {p.status === "draft" && (
                <span className="pcms-draftbadge">{t("content.status.draft")}</span>
              )}
            </button>
            <button
              className="pcms-tree__add"
              title={t("pages.addChild")}
              onClick={() => createPage(t("pages.newTitle"), "page", p.slug)}
            >
              ＋子
            </button>
          </div>
          <Tree parent={p.slug} depth={depth + 1} />
        </div>
      ))}
    </>
  );

  return (
    <div className="pcms-contentpane">
      <div className="pcms-contentpane__list">
        <div className="pcms-listhead">
          <h1 className="pcms-page__title">{t("site.tab.pages")}</h1>
          <div className="pcms-listhead__actions">
            <button className="pcms-primary" onClick={() => setNewOpen(true)}>
              ＋ {t("pages.new")}
            </button>
          </div>
        </div>

        {pages.length > 0 && (
          <div className="pcms-listsearch">
            <input
              type="search"
              className="pcms-listsearch__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("content.search")}
            />
            {q && (
              <span className="pcms-listsearch__count">
                {t("content.matchCount").replace("{count}", String(matches.length))}
              </span>
            )}
          </div>
        )}

        {pages.length === 0 ? (
          <p className="pcms-empty">{t("content.none")}</p>
        ) : q ? (
          matches.length === 0 ? (
            <p className="pcms-empty">{t("pages.noMatch")}</p>
          ) : (
            <ul className="pcms-itemlist">
              {matches.map((p) => (
                <li key={p.slug}>
                  <button
                    className={`pcms-itemlist__row${selected === p.slug ? " is-selected" : ""}`}
                    onClick={() => setSelected(p.slug)}
                  >
                    <span className="pcms-itemlist__title">
                      {String(p.fields.title ?? p.slug)}
                      {p.status === "draft" && (
                        <span className="pcms-draftbadge">{t("content.status.draft")}</span>
                      )}
                    </span>
                    <span className="pcms-itemlist__slug">/{p.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="pcms-tree">
            <Tree parent={undefined} depth={0} />
          </div>
        )}
      </div>

      <div className="pcms-contentpane__editor">
        {selected ? (
          <ContentEditorPanel
            type={PAGE_TYPE}
            slug={selected}
            onDeleted={() => setSelected(null)}
            onDuplicated={(_type, slug) => setSelected(slug)}
          />
        ) : (
          <aside className="pcms-settings">
            <p className="pcms-empty">{t("content.pickHint")}</p>
          </aside>
        )}
      </div>

      {newOpen && (
        <NewContentModal
          types={pageTypes}
          onCreate={(type, title, slug) => createPage(title, slug)}
          onClose={() => setNewOpen(false)}
        />
      )}
    </div>
  );
}
