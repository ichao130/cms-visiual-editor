import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Multi-theme storage for the desktop app.
 *
 * The bundled `sample-cafe` theme is always available and read from the shipped
 * resources (or the dev repo). Imported themes — e.g. a converted WordPress
 * theme — are written as self-contained theme folders under
 * `userData/themes/<id>/`, each with a `theme-meta.json`. A single pointer file,
 * `userData/site/active-theme.json`, records which theme is active; everything
 * else in the app (theme reading, the code-editor overlay, published output)
 * reads it to resolve the current theme directory. CLAUDE.md: the bundled theme
 * files on disk are never modified; only imported themes live under userData.
 */

export const SAMPLE_THEME_ID = "sample-cafe";

function userDataDir(): string {
  return app.getPath("userData");
}

function siteDir(): string {
  const dir = join(userDataDir(), "site");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Root folder holding imported themes, one subfolder per theme id. */
export function themesRoot(): string {
  const dir = join(userDataDir(), "themes");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** The on-disk folder for an imported theme (not the bundled sample). */
export function themeRoot(id: string): string {
  return join(themesRoot(), id);
}

function activeThemePath(): string {
  return join(siteDir(), "active-theme.json");
}

/** The active theme id; defaults to the bundled sample when unset/invalid. */
export function activeThemeId(): string {
  try {
    const obj = JSON.parse(readFileSync(activeThemePath(), "utf8")) as { id?: unknown };
    if (typeof obj.id === "string" && obj.id) return obj.id;
  } catch {
    /* no pointer yet — the sample is active */
  }
  return SAMPLE_THEME_ID;
}

export function setActiveThemeId(id: string): void {
  writeFileSync(activeThemePath(), JSON.stringify({ id }, null, 2), "utf8");
}

export interface ThemeMetaFile {
  id: string;
  name: string;
  description?: string;
  source?: string;
}

/** Read an imported theme's `theme-meta.json`, or null when absent/unreadable. */
export function readThemeMeta(id: string): ThemeMetaFile | null {
  try {
    const obj = JSON.parse(readFileSync(join(themeRoot(id), "theme-meta.json"), "utf8")) as ThemeMetaFile;
    if (obj && typeof obj.id === "string") return obj;
  } catch {
    /* not an imported theme, or no meta */
  }
  return null;
}

/** Turn a human theme name into a filesystem-safe, unique id under themesRoot(). */
export function uniqueThemeId(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "theme";
  let id = base;
  let n = 2;
  while (id === SAMPLE_THEME_ID || existsSync(themeRoot(id))) {
    id = `${base}-${n++}`;
  }
  return id;
}
