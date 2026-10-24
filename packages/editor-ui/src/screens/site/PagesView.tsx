import { useState } from "react";
import { useSiteWorkspace } from "../../state/SiteWorkspace.js";
import { createContent, slugExists } from "../../state/editorState.js";
import { NewContentModal } from "../../components/NewContentModal.js";
import { ContentEditorPanel } from "./ContentEditorPanel.js";
import { t } from "../../i18n.js";

const PAGE_TYPE = "page";

/** Fixed pages, shown and created as a hierarchy (parent/child). */
export function PagesView() {
  const { doc, commit, setDirty, dirty, save } = useSiteWorkspace();
  const [selected, setSelected] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const pages = doc.content.filter((i) => i.type === PAGE_TYPE);
  const childrenOf = (parent: string | undefined) =>
    pages.filter((p) => (p.parent ?? undefined) === parent);

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
            <button onClick={save} disabled={!dirty}>
              {dirty ? t("common.save") : t("common.saved")}
            </button>
          </div>
        </div>

        {pages.length === 0 ? (
          <p className="pcms-empty">{t("content.none")}</p>
        ) : (
          <div className="pcms-tree">
            <Tree parent={undefined} depth={0} />
          </div>
        )}
      </div>

      <div className="pcms-contentpane__editor">
        {selected ? (
          <ContentEditorPanel type={PAGE_TYPE} slug={selected} onDeleted={() => setSelected(null)} />
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
