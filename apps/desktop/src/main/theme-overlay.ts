import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { ProjectData } from "@pcms/editor-ui";
import type { ThemeBundle } from "@pcms/engine";
import { isBinaryAsset, isThemeTombstone } from "@pcms/engine";
import { activeThemeId, SAMPLE_THEME_ID } from "./theme-store.js";

/**
 * The code editor's theme working copy.
 *
 * CLAUDE.md: the theme files on disk are never modified — the operator's edits
 * (CSS, sections, blocks, templates, layout, theme.json created or changed in the
 * code editor) live on the site side. They are kept here as a path→content map,
 * persisted to the site directory so they survive a restart, overlaid onto the
 * loaded project for the editor/preview AND for the published output (so a direct
 * CSS edit actually ships).
 */

function overlayPath(): string {
  const dir = join(app.getPath("userData"), "site");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // The overlay (code-editor working copy) is per theme, so switching themes
  // shows the right edits. The sample keeps the legacy filename for back-compat.
  const id = activeThemeId();
  return join(dir, id === SAMPLE_THEME_ID ? "theme-overlay.json" : `theme-overlay.${id}.json`);
}

let cache: Map<string, string> | null = null;
let cacheId: string | null = null;

function store(): Map<string, string> {
  const id = activeThemeId();
  if (cache && cacheId === id) return cache;
  cache = new Map();
  cacheId = id;
  try {
    const raw = readFileSync(overlayPath(), "utf8");
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") cache.set(k, v);
    }
  } catch {
    /* no working copy yet */
  }
  return cache;
}

function persist(): void {
  const obj: Record<string, string> = {};
  for (const [k, v] of store()) obj[k] = v;
  try {
    writeFileSync(overlayPath(), JSON.stringify(obj, null, 2), "utf8");
  } catch {
    /* best effort — the edit still lives in-memory for this session */
  }
}

export function overlayHas(path: string): boolean {
  return store().has(path);
}

export function overlayGet(path: string): string | undefined {
  return store().get(path);
}

export function overlayKeys(): string[] {
  return [...store().keys()];
}

export function overlaySize(): number {
  return store().size;
}

export function overlaySet(path: string, content: string): void {
  store().set(path, content);
  persist();
}

export function overlayDelete(path: string): void {
  if (store().delete(path)) persist();
}

export function overlayClear(): void {
  store().clear();
  persist();
}

/**
 * Delete the persisted working-copy overlay for a specific theme (used when that
 * theme is removed). Targets the file by id directly — not the active theme — and
 * drops the in-memory cache if it was holding that theme's overlay.
 */
export function removeOverlayForTheme(id: string): void {
  const dir = join(app.getPath("userData"), "site");
  const file = join(dir, id === SAMPLE_THEME_ID ? "theme-overlay.json" : `theme-overlay.${id}.json`);
  try {
    if (existsSync(file)) rmSync(file);
  } catch {
    /* best effort — a missing overlay is fine */
  }
  if (cacheId === id) {
    cache = null;
    cacheId = null;
  }
}

/**
 * Overlay the code-editor working copy onto a loaded project's theme, so parts
 * and styles created or edited in the code editor flow into the visual editor,
 * the preview, and the published output. The files on disk are untouched. Called
 * with loadProject's result; returns it unchanged when there are no edits.
 */
export function applyThemeOverlay(project: ProjectData): ProjectData {
  if (overlaySize() === 0) return project;
  const theme: ThemeBundle = {
    ...project.theme,
    sections: { ...project.theme.sections },
    blocks: { ...project.theme.blocks },
    templates: { ...project.theme.templates },
  };
  let previewCss = project.previewCss;
  const assets = new Set(project.theme.assets ?? []);
  const themeAssets: Record<string, string> = { ...project.themeAssets };
  const themeTextAssets: Record<string, string> = { ...project.themeTextAssets };
  for (const [path, content] of store()) {
    // A tombstoned path is a deleted original: remove it from the theme so it
    // drops out of the editor, the preview and the published output. The file on
    // disk is left untouched (CLAUDE.md); resetTheme restores it.
    const deleted = isThemeTombstone(content);
    const sec = /^sections\/(.+)\.html$/.exec(path);
    if (sec?.[1]) {
      const next = { ...theme.sections };
      if (deleted) delete next[sec[1]];
      else next[sec[1]] = content;
      theme.sections = next;
      continue;
    }
    const blk = /^blocks\/(.+)\.html$/.exec(path);
    if (blk?.[1]) {
      const next = { ...theme.blocks };
      if (deleted) delete next[blk[1]];
      else next[blk[1]] = content;
      theme.blocks = next;
      continue;
    }
    const tpl = /^templates\/(.+)\.html$/.exec(path);
    if (tpl?.[1]) {
      const next = { ...theme.templates };
      if (deleted) delete next[tpl[1]];
      else next[tpl[1]] = content;
      theme.templates = next;
      continue;
    }
    if (path === "layout.html") theme.layout = deleted ? "" : content;
    else if (path === "assets/style.css") previewCss = deleted ? "" : content;
    else if (path === "theme.json") {
      if (deleted) continue; // keep the loaded config
      try {
        theme.config = JSON.parse(content) as ThemeBundle["config"];
      } catch {
        /* keep the existing config on bad JSON */
      }
    } else if (path.startsWith("assets/")) {
      if (deleted) {
        assets.delete(path);
        delete themeAssets[path];
        delete themeTextAssets[path];
        continue;
      }
      // Operator-added asset (image/JS/CSS/HTML): copy it into the output and
      // expose it to the preview — binary as a data URL, text as its contents
      // (so an added stylesheet / script is inlined into the sandboxed preview).
      assets.add(path);
      if (isBinaryAsset(path)) themeAssets[path] = content;
      else themeTextAssets[path] = content;
    }
  }
  theme.assets = [...assets];
  return { ...project, theme, previewCss, themeAssets, themeTextAssets };
}
