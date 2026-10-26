/**
 * In-app navigation. This is a GUI desktop app with no URLs, so routing is a
 * small typed state machine rather than react-router: a `Route` union plus a
 * `setRoute` setter held by the shell.
 */

export type SiteTab =
  | "info"
  | "posts"
  | "pages"
  | "types"
  | "taxonomies"
  | "menus"
  | "forms"
  | "settings"
  | "theme"
  | "publish";
export type ThemeMode = "visual" | "code";

export type Route =
  | { screen: "dashboard" }
  | { screen: "project"; projectId: string }
  | { screen: "site"; siteId: string; tab: SiteTab }
  | { screen: "themeEditor"; siteId: string; mode: ThemeMode };

export const INITIAL_ROUTE: Route = { screen: "dashboard" };

/** The site a route is scoped to, if any (for loading the workspace). */
export function routeSiteId(route: Route): string | null {
  return route.screen === "site" || route.screen === "themeEditor" ? route.siteId : null;
}
