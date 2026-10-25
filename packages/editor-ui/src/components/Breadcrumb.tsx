import type { SiteSummary } from "../api/types.js";
import type { Route, SiteTab } from "../state/route.js";
import { t, type MessageKey } from "../i18n.js";

interface Crumb {
  label: string;
  route?: Route;
}

interface BreadcrumbProps {
  route: Route;
  projectNameOf: (id: string) => string;
  siteEntryOf: (id: string) => { site: SiteSummary; projectId: string } | undefined;
  onNavigate: (route: Route) => void;
}

const TAB_LABEL: Record<SiteTab, MessageKey> = {
  info: "site.tab.info",
  posts: "site.tab.posts",
  pages: "site.tab.pages",
  forms: "site.tab.forms",
  settings: "site.tab.settings",
  theme: "site.tab.theme",
  publish: "site.tab.publish",
};

/** Clickable breadcrumb derived from the current route and loaded names. */
export function Breadcrumb({ route, projectNameOf, siteEntryOf, onNavigate }: BreadcrumbProps) {
  const crumbs: Crumb[] = [{ label: t("dashboard.title"), route: { screen: "dashboard" } }];

  const addSiteChain = (siteId: string) => {
    const entry = siteEntryOf(siteId);
    if (entry) {
      crumbs.push({
        label: projectNameOf(entry.projectId),
        route: { screen: "project", projectId: entry.projectId },
      });
      crumbs.push({
        label: entry.site.name,
        route: { screen: "site", siteId, tab: "info" },
      });
    } else {
      crumbs.push({ label: siteId, route: { screen: "site", siteId, tab: "info" } });
    }
  };

  if (route.screen === "project") {
    crumbs.push({ label: projectNameOf(route.projectId) });
  } else if (route.screen === "site") {
    addSiteChain(route.siteId);
    crumbs.push({ label: t(TAB_LABEL[route.tab]) });
  } else if (route.screen === "themeEditor") {
    addSiteChain(route.siteId);
    crumbs.push({
      label: t("site.tab.theme"),
      route: { screen: "site", siteId: route.siteId, tab: "theme" },
    });
    crumbs.push({ label: t("themeEditor.title") });
  }

  return (
    <nav className="pcms-crumbs" aria-label="breadcrumb">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="pcms-crumbs__item">
            {i > 0 && <span className="pcms-crumbs__sep">/</span>}
            {c.route && !last ? (
              <button className="pcms-crumbs__link" onClick={() => onNavigate(c.route as Route)}>
                {c.label}
              </button>
            ) : (
              <span className="pcms-crumbs__current">{c.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
