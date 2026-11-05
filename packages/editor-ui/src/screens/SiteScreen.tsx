import { useEffect, useMemo } from "react";
import type { ContentTypeDef, MenuItem, TaxonomyDef } from "@pcms/shared";
import { buildLinkTargets } from "../state/linkTargets.js";
import type { PcmsApi } from "../api/types.js";
import type { Route, SiteTab } from "../state/route.js";
import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import { setMenu, setTaxonomies } from "../state/editorState.js";
import { MediaContext, useMediaLibrary } from "../media/MediaContext.js";
import { SiteInfoView } from "./site/SiteInfoView.js";
import { PostsView } from "./site/PostsView.js";
import { PagesView } from "./site/PagesView.js";
import { MediaView } from "./site/MediaView.js";
import { FormsView } from "./site/FormsView.js";
import { RedirectsView } from "./site/RedirectsView.js";
import { SiteSettingsView } from "./site/SiteSettingsView.js";
import { ThemeView } from "./site/ThemeView.js";
import { PublishFlow } from "../components/PublishFlow.js";
import { ContentTypeManager } from "../components/ContentTypeManager.js";
import { TaxonomyManager } from "../components/TaxonomyManager.js";
import { MenuManager } from "../components/MenuManager.js";
import { SiteSaveBar } from "../components/SiteSaveBar.js";
import { t, type MessageKey } from "../i18n.js";

/** Tabs that edit the shared workspace document and share the save bar. */
const SAVEBAR_TABS: ReadonlySet<SiteTab> = new Set<SiteTab>([
  "posts",
  "pages",
  "types",
  "taxonomies",
  "menus",
  "settings",
]);

interface Props {
  api: PcmsApi;
  route: Extract<Route, { screen: "site" }>;
  onNavigate: (route: Route) => void;
}

interface NavItem {
  id: SiteTab;
  label: MessageKey;
}

interface NavGroup {
  heading?: MessageKey;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { items: [{ id: "info", label: "site.tab.info" }] },
  {
    heading: "nav.group.content",
    items: [
      { id: "posts", label: "site.tab.posts" },
      { id: "pages", label: "site.tab.pages" },
      { id: "media", label: "site.tab.media" },
    ],
  },
  {
    heading: "nav.group.structure",
    items: [
      { id: "types", label: "site.tab.types" },
      { id: "taxonomies", label: "site.tab.taxonomies" },
      { id: "menus", label: "site.tab.menus" },
    ],
  },
  {
    heading: "nav.group.ops",
    items: [
      { id: "forms", label: "site.tab.forms" },
      { id: "redirects", label: "site.tab.redirects" },
      { id: "publish", label: "site.tab.publish" },
    ],
  },
  { heading: "nav.group.design", items: [{ id: "theme", label: "site.tab.theme" }] },
  { items: [{ id: "settings", label: "site.tab.settings" }] },
];

/**
 * A site's workspace: a grouped left sub-nav (overview / content / structure /
 * operations / design / settings), content on the right. The site-structure
 * tabs (content types / taxonomies / menus) are full pages; the media library
 * opens from the nav as a picker. Rendered inside a SiteWorkspaceProvider, so
 * everything shares one document.
 */
export function SiteScreen({ api, route, onNavigate }: Props) {
  const media = useMediaLibrary(api);
  const { doc, commit, setDirty, dirty, save, undo, redo, canUndo, canRedo } = useSiteWorkspace();
  const { siteId, tab } = route;

  // Keyboard shortcuts for the editing tabs: Cmd/Ctrl+S saves the workspace;
  // Cmd/Ctrl+Z / Shift+Cmd+Z (or Ctrl+Y) undo/redo, but only when focus is not
  // in a text field so the field keeps its own native undo.
  const editing = SAVEBAR_TABS.has(tab);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (editing && dirty) save();
        return;
      }
      if (!editing) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        if (canRedo) redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, dirty, save, undo, redo, canUndo, canRedo]);

  const onTypesCommit = (types: ContentTypeDef[]) => {
    commit({ ...doc, contentTypes: types });
    setDirty(true);
  };
  const onTaxCommit = (taxonomies: TaxonomyDef[]) => {
    commit(setTaxonomies(doc, taxonomies));
    setDirty(true);
  };
  const onMenuCommit = (name: string, items: MenuItem[]) => {
    commit(setMenu(doc, name, items), `menu:${name}`);
    setDirty(true);
  };

  // Pages/posts/archives the operator can link to (menu + redirect pickers).
  const linkTargets = useMemo(() => buildLinkTargets(doc), [doc]);

  return (
    <MediaContext.Provider value={media.value}>
      <div className="pcms-sitelayout">
        <nav className="pcms-subnav" aria-label={t("sections.title")}>
          {NAV.map((group, gi) => (
            <div key={gi} className="pcms-subnav__group">
              {group.heading && <div className="pcms-subnav__heading">{t(group.heading)}</div>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`pcms-subnav__item${tab === item.id ? " is-active" : ""}`}
                  onClick={() => onNavigate({ screen: "site", siteId, tab: item.id })}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <section className="pcms-sitecontent">
          {SAVEBAR_TABS.has(tab) && <SiteSaveBar />}
          <div className="pcms-sitecontent__body">
          {tab === "info" && <SiteInfoView api={api} siteId={siteId} />}
          {tab === "posts" && <PostsView />}
          {tab === "pages" && <PagesView />}
          {tab === "media" && <MediaView />}
          {tab === "types" && (
            <ContentTypeManager types={doc.contentTypes} onCommit={onTypesCommit} />
          )}
          {tab === "taxonomies" && (
            <TaxonomyManager
              taxonomies={doc.taxonomies}
              contentTypes={doc.contentTypes}
              onCommit={onTaxCommit}
            />
          )}
          {tab === "menus" && (
            <MenuManager menus={doc.menus} onCommit={onMenuCommit} targets={linkTargets} />
          )}
          {tab === "forms" && <FormsView api={api} siteId={siteId} />}
          {tab === "redirects" && <RedirectsView api={api} siteId={siteId} />}
          {tab === "settings" && <SiteSettingsView />}
          {tab === "theme" && <ThemeView api={api} siteId={siteId} onNavigate={onNavigate} />}
          {tab === "publish" && (
            <div className="pcms-publishview">
              <h1 className="pcms-page__title">{t("site.tab.publish")}</h1>
              <PublishFlow api={api} />
            </div>
          )}
          </div>
        </section>
      </div>
      {media.modal}
    </MediaContext.Provider>
  );
}
