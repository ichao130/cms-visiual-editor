import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountView, PcmsApi, ProjectSummary, SiteSummary } from "../api/types.js";
import { INITIAL_ROUTE, routeSiteId, type Route } from "../state/route.js";
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
  // Bumped after creating a project/site so the breadcrumb index + counts reload.
  const [shellVersion, setShellVersion] = useState(0);
  const reloadShell = useCallback(() => setShellVersion((v) => v + 1), []);

  // The open site's unsaved state, reported up by the workspace, so navigating
  // away from the site can warn before the document (and its edits) unmount.
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  // A ref mirrors the current route so `navigate` stays identity-stable and the
  // confirm() runs outside setRoute (keeping the state updater pure).
  const routeRef = useRef(route);
  routeRef.current = route;
  const navigate = useCallback((next: Route) => {
    const current = routeRef.current;
    const leavingSite =
      routeSiteId(current) != null && routeSiteId(next) !== routeSiteId(current);
    if (leavingSite && dirtyRef.current && !window.confirm(t("nav.unsavedConfirm"))) return;
    setRoute(next);
  }, []);

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
  }, [api, shellVersion]);

  const projectName = useCallback(
    (id: string) => projects.find((p) => p.id === id)?.name ?? id,
    [projects],
  );
  const siteEntry = useCallback((id: string) => siteIndex.get(id), [siteIndex]);

  const siteId = route.screen === "site" || route.screen === "themeEditor" ? route.siteId : null;

  const screen = useMemo(() => {
    switch (route.screen) {
      case "dashboard":
        return (
          <DashboardScreen
            api={api}
            account={account}
            onNavigate={navigate}
            onShellChange={reloadShell}
          />
        );
      case "project":
        return (
          <ProjectScreen
            api={api}
            projectId={route.projectId}
            onNavigate={navigate}
            onShellChange={reloadShell}
          />
        );
      case "site":
        return <SiteScreen api={api} route={route} onNavigate={navigate} />;
      case "themeEditor":
        return <ThemeEditorScreen api={api} route={route} onNavigate={navigate} />;
    }
    // `locale` is a dep so screens re-render (re-run t()) on a language switch.
  }, [route, api, account, locale, navigate, reloadShell]);

  // The workspace is keyed by site so switching sites reloads its document.
  const body =
    siteId != null ? (
      <SiteWorkspaceProvider
        key={siteId}
        api={api}
        siteId={siteId}
        onDirtyChange={onDirtyChange}
      >
        {screen}
      </SiteWorkspaceProvider>
    ) : (
      screen
    );

  return (
    <div className="pcms-shell">
      <header className="pcms-topbar">
        <button className="pcms-topbar__brand" onClick={() => navigate(INITIAL_ROUTE)}>
          pcms
        </button>
        <Breadcrumb
          route={route}
          projectNameOf={projectName}
          siteEntryOf={siteEntry}
          onNavigate={navigate}
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
            onClick={() => navigate(INITIAL_ROUTE)}
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
