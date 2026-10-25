import { useState } from "react";
import type { ContentTypeDef, MenuItem, TaxonomyDef } from "@pcms/shared";
import type { PcmsApi } from "../api/types.js";
import type { Route, SiteTab } from "../state/route.js";
import { useSiteWorkspace } from "../state/SiteWorkspace.js";
import { setMenu, setTaxonomies } from "../state/editorState.js";
import { MediaContext, useMediaLibrary } from "../media/MediaContext.js";
import { SiteInfoView } from "./site/SiteInfoView.js";
import { PostsView } from "./site/PostsView.js";
import { PagesView } from "./site/PagesView.js";
import { FormsView } from "./site/FormsView.js";
import { SiteSettingsView } from "./site/SiteSettingsView.js";
import { ThemeView } from "./site/ThemeView.js";
import { PublishFlow } from "../components/PublishFlow.js";
import { ContentTypeManager } from "../components/ContentTypeManager.js";
import { TaxonomyManager } from "../components/TaxonomyManager.js";
import { MenuManager } from "../components/MenuManager.js";
import { t, type MessageKey } from "../i18n.js";

interface Props {
  api: PcmsApi;
  route: Extract<Route, { screen: "site" }>;
  onNavigate: (route: Route) => void;
}

/** A dialog opened from the site nav (site structure / media). */
type ManagerKey = "types" | "taxonomies" | "menus";

type NavItem =
  | { kind: "tab"; id: SiteTab; label: MessageKey }
  | { kind: "action"; key: string; label: MessageKey };

interface NavGroup {
  heading?: MessageKey;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { items: [{ kind: "tab", id: "info", label: "site.tab.info" }] },
  {
    heading: "nav.group.content",
    items: [
      { kind: "tab", id: "posts", label: "site.tab.posts" },
      { kind: "tab", id: "pages", label: "site.tab.pages" },
      { kind: "action", key: "media", label: "site.tab.media" },
    ],
  },
  {
    heading: "nav.group.structure",
    items: [
      { kind: "action", key: "types", label: "site.tab.types" },
      { kind: "action", key: "taxonomies", label: "site.tab.taxonomies" },
      { kind: "action", key: "menus", label: "site.tab.menus" },
    ],
  },
  {
    heading: "nav.group.ops",
    items: [
      { kind: "tab", id: "forms", label: "site.tab.forms" },
      { kind: "tab", id: "publish", label: "site.tab.publish" },
    ],
  },
  { heading: "nav.group.design", items: [{ kind: "tab", id: "theme", label: "site.tab.theme" }] },
  { items: [{ kind: "tab", id: "settings", label: "site.tab.settings" }] },
];

/**
 * A site's workspace: a grouped left sub-nav (overview / content / structure /
 * operations / design / settings), content on the right. Site-structure
 * managers and the media library open from the nav. Rendered inside a
 * SiteWorkspaceProvider, so everything shares one document.
 */
export function SiteScreen({ api, route, onNavigate }: Props) {
  const media = useMediaLibrary(api);
  const { doc, commit, setDirty } = useSiteWorkspace();
  const { siteId, tab } = route;
  const [manager, setManager] = useState<ManagerKey | null>(null);

  const onAction = (key: string) => {
    if (key === "media") media.value.openLibrary();
    else setManager(key as ManagerKey);
  };

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

  return (
    <MediaContext.Provider value={media.value}>
      <div className="pcms-sitelayout">
        <nav className="pcms-subnav" aria-label={t("sections.title")}>
          {NAV.map((group, gi) => (
            <div key={gi} className="pcms-subnav__group">
              {group.heading && <div className="pcms-subnav__heading">{t(group.heading)}</div>}
              {group.items.map((item) =>
                item.kind === "tab" ? (
                  <button
                    key={item.id}
                    className={`pcms-subnav__item${tab === item.id ? " is-active" : ""}`}
                    onClick={() => onNavigate({ screen: "site", siteId, tab: item.id })}
                  >
                    {t(item.label)}
                  </button>
                ) : (
                  <button
                    key={item.key}
                    className="pcms-subnav__item"
                    onClick={() => onAction(item.key)}
                  >
                    {t(item.label)}
                  </button>
                ),
              )}
            </div>
          ))}
        </nav>
        <section className="pcms-sitecontent">
          {tab === "info" && <SiteInfoView api={api} siteId={siteId} />}
          {tab === "posts" && <PostsView />}
          {tab === "pages" && <PagesView />}
          {tab === "forms" && <FormsView api={api} />}
          {tab === "settings" && <SiteSettingsView />}
          {tab === "theme" && <ThemeView api={api} siteId={siteId} onNavigate={onNavigate} />}
          {tab === "publish" && (
            <div className="pcms-publishview">
              <h1 className="pcms-page__title">{t("site.tab.publish")}</h1>
              <PublishFlow api={api} />
            </div>
          )}
        </section>
      </div>

      {manager === "types" && (
        <ContentTypeManager
          types={doc.contentTypes}
          onCommit={onTypesCommit}
          onClose={() => setManager(null)}
        />
      )}
      {manager === "taxonomies" && (
        <TaxonomyManager
          taxonomies={doc.taxonomies}
          contentTypes={doc.contentTypes}
          onCommit={onTaxCommit}
          onClose={() => setManager(null)}
        />
      )}
      {manager === "menus" && (
        <MenuManager menus={doc.menus} onCommit={onMenuCommit} onClose={() => setManager(null)} />
      )}
      {media.modal}
    </MediaContext.Provider>
  );
}
