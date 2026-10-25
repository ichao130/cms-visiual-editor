import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountView, PcmsApi, ProjectSummary, SiteSummary } from "../api/types.js";
import { INITIAL_ROUTE, type Route } from "../state/route.js";
import { SiteWorkspaceProvider } from "../state/SiteWorkspace.js";
import { Breadcrumb } from "./Breadcrumb.js";
import { DashboardScreen } from "../screens/DashboardScreen.js";
import { ProjectScreen } from "../screens/ProjectScreen.js";
import { SiteScreen } from "../screens/SiteScreen.js";
import { ThemeEditorScreen } from "../screens/ThemeEditorScreen.js";
import { t, useLocale, setLocale } from "../i18n.js";

interface AppProps {
  api: PcmsApi;
}

interface SiteEntry {
  site: SiteSummary;
  projectId: string;
}

/**
 * App shell: top bar + breadcrumb, and the current screen chosen by a typed
 * route (dashboard → project → site → theme editor). The theme/content screens
 * mount inside a SiteWorkspaceProvider so they share one site document.
 */
export function App({ api }: AppProps) {
  const locale = useLocale();
  const [route, setRoute] = useState<Route>(INITIAL_ROUTE);
  const [account, setAccount] = useState<AccountView | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [siteIndex, setSiteIndex] = useState<Map<string, SiteEntry>>(new Map());

  useEffect(() => {
    let active = true;
    void api.loadAccount().then((a) => active && setAccount(a));
    void api.listProjects().then(async (ps) => {
      if (!active) return;
      setProjects(ps);
      const idx = new Map<string, SiteEntry>();
      for (const p of ps) {
        const sites = await api.listSites(p.id);
        for (const s of sites) idx.set(s.id, { site: s, projectId: p.id });
      }
      if (active) setSiteIndex(idx);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const projectName = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? id,
    [projects],
  );
  const siteEntry = useCallback((id: string) => siteIndex.get(id), [siteIndex]);

  const siteId = route.screen === "site" || route.screen === "themeEditor" ? route.siteId : null;

  const screen = useMemo(() => {
    switch (route.screen) {
      case "dashboard":
        return <DashboardScreen api={api} account={account} onNavigate={setRoute} />;
      case "project":
        return <ProjectScreen api={api} projectId={route.projectId} onNavigate={setRoute} />;
      case "site":
        return <SiteScreen api={api} route={route} onNavigate={setRoute} />;
      case "themeEditor":
        return <ThemeEditorScreen api={api} route={route} onNavigate={setRoute} />;
    }
    // `locale` is a dep so screens re-render (re-run t()) on a language switch.
  }, [route, api, account, locale]);

  // The workspace is keyed by site so switching sites reloads its document.
  const body =
    siteId != null ? (
      <SiteWorkspaceProvider key={siteId} api={api} siteId={siteId}>
        {screen}
      </SiteWorkspaceProvider>
    ) : (
      screen
    );

  return (
    <div className="pcms-shell">
      <header className="pcms-topbar">
        <button className="pcms-topbar__brand" onClick={() => setRoute(INITIAL_ROUTE)}>
          pcms
        </button>
        <Breadcrumb
          route={route}
          projectNameOf={projectName}
          siteEntryOf={siteEntry}
          onNavigate={setRoute}
        />
        <div className="pcms-topbar__spacer" />
        <div className="pcms-langtoggle" role="group" aria-label="language">
          <button
            className={locale === "ja" ? "is-active" : ""}
            onClick={() => setLocale("ja")}
          >
            JA
          </button>
          <button
            className={locale === "en" ? "is-active" : ""}
            onClick={() => setLocale("en")}
          >
            EN
          </button>
        </div>
        {account && (
          <button
            className="pcms-topbar__account"
            onClick={() => setRoute(INITIAL_ROUTE)}
            title={t("account.title")}
          >
            {account.name}
          </button>
        )}
      </header>
      <main className="pcms-shell__main">{body}</main>
    </div>
  );
}
