import type { PcmsApi } from "../api/types.js";
import type { Route, SiteTab } from "../state/route.js";
import { MediaContext, useMediaLibrary } from "../media/MediaContext.js";
import { SiteInfoView } from "./site/SiteInfoView.js";
import { PostsView } from "./site/PostsView.js";
import { PagesView } from "./site/PagesView.js";
import { SiteSettingsView } from "./site/SiteSettingsView.js";
import { ThemeView } from "./site/ThemeView.js";
import { t, type MessageKey } from "../i18n.js";

interface Props {
  api: PcmsApi;
  route: Extract<Route, { screen: "site" }>;
  onNavigate: (route: Route) => void;
}

const TABS: { id: SiteTab; label: MessageKey }[] = [
  { id: "info", label: "site.tab.info" },
  { id: "posts", label: "site.tab.posts" },
  { id: "pages", label: "site.tab.pages" },
  { id: "settings", label: "site.tab.settings" },
  { id: "theme", label: "site.tab.theme" },
];

/**
 * A site's workspace: left sub-nav over its sections, content on the right.
 * Wrapped in a media library so the content forms can pick images. Rendered
 * inside a SiteWorkspaceProvider (see App), so the views share one document.
 */
export function SiteScreen({ api, route, onNavigate }: Props) {
  const media = useMediaLibrary(api);
  const { siteId, tab } = route;

  return (
    <MediaContext.Provider value={media.value}>
      <div className="pcms-sitelayout">
        <nav className="pcms-subnav">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              className={`pcms-subnav__item${tab === tb.id ? " is-active" : ""}`}
              onClick={() => onNavigate({ screen: "site", siteId, tab: tb.id })}
            >
              {t(tb.label)}
            </button>
          ))}
        </nav>
        <section className="pcms-sitecontent">
          {tab === "info" && <SiteInfoView api={api} siteId={siteId} />}
          {tab === "posts" && <PostsView />}
          {tab === "pages" && <PagesView />}
          {tab === "settings" && <SiteSettingsView />}
          {tab === "theme" && <ThemeView api={api} siteId={siteId} onNavigate={onNavigate} />}
        </section>
      </div>
      {media.modal}
    </MediaContext.Provider>
  );
}
