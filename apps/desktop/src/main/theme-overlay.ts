import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { ProjectData } from "@pcms/editor-ui";
import type { ThemeBundle } from "@pcms/engine";

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
  return join(dir, "theme-overlay.json");
}

let cache: Map<string, string> | null = null;

function store(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();
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
  for (const [path, content] of store()) {
    const sec = /^sections\/(.+)\.html$/.exec(path);
    if (sec?.[1]) {
      theme.sections = { ...theme.sections, [sec[1]]: content };
      continue;
    }
    const blk = /^blocks\/(.+)\.html$/.exec(path);
    if (blk?.[1]) {
      theme.blocks = { ...theme.blocks, [blk[1]]: content };
      continue;
    }
    const tpl = /^templates\/(.+)\.html$/.exec(path);
    if (tpl?.[1]) {
      theme.templates = { ...theme.templates, [tpl[1]]: content };
      continue;
    }
    if (path === "layout.html") theme.layout = content;
    else if (path === "assets/style.css") previewCss = content;
    else if (path === "theme.json") {
      try {
        theme.config = JSON.parse(content) as ThemeBundle["config"];
      } catch {
        /* keep the existing config on bad JSON */
      }
    }
  }
  return { ...project, theme, previewCss };
}
