import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type {
  AccountView,
  ProjectData,
  ProjectSummary,
  SiteStats,
  SiteSummary,
  ThemeFileKind,
  ThemeFileNode,
  ThemeSummary,
} from "@pcms/editor-ui";
import type { FormDef, FormSubmission } from "@pcms/shared";
import type { ThemeBundle } from "@pcms/engine";
import { renameSection } from "@pcms/engine";
import { loadProject } from "./project.js";

/** The built-in local project/site, always present. */
const LOCAL_PROJECT_ID = "local";

interface ShellRegistry {
  projects: ProjectSummary[];
  sites: Record<string, SiteSummary[]>;
}

function registryPath(): string {
  const dir = app.getPath("userData");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "shell.json");
}

function loadRegistry(): ShellRegistry {
  try {
    const path = registryPath();
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as ShellRegistry;
  } catch {
    /* fall through to empty registry */
  }
  return { projects: [], sites: {} };
}

function saveRegistry(reg: ShellRegistry): void {
  writeFileSync(registryPath(), JSON.stringify(reg, null, 2), "utf8");
}

/**
 * App-shell data for the desktop build. This is a local, single-project view —
 * the cloud account, multi-project listing and analytics are wired later. Theme
 * file edits are kept in an in-session working copy so the theme files on disk
 * are never modified (CLAUDE.md: テーマのファイルは改変しない).
 */

const themeOverlay = new Map<string, string>();

export async function loadAccount(): Promise<AccountView> {
  return { name: "ローカルユーザー", email: "local@pcms", plan: "ローカル", ai: { used: 0, limit: 100 } };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const reg = loadRegistry();
  const local: ProjectSummary = {
    id: LOCAL_PROJECT_ID,
    name: "ローカルプロジェクト",
    siteCount: 1 + (reg.sites[LOCAL_PROJECT_ID]?.length ?? 0),
  };
  return [local, ...reg.projects].map((p) =>
    p.id === LOCAL_PROJECT_ID ? p : { ...p, siteCount: reg.sites[p.id]?.length ?? 0 },
  );
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const reg = loadRegistry();
  const project: ProjectSummary = { id: `proj-${Date.now()}`, name, siteCount: 0 };
  reg.projects.push(project);
  saveRegistry(reg);
  return project;
}

export async function listSites(projectId: string): Promise<SiteSummary[]> {
  const reg = loadRegistry();
  const created = reg.sites[projectId] ?? [];
  if (projectId !== LOCAL_PROJECT_ID) return created;

  const project = await loadProject();
  const baseUrl = project.site.baseUrl ?? "";
  let domain = baseUrl;
  try {
    domain = new URL(baseUrl).host;
  } catch {
    domain = baseUrl;
  }
  return [
    {
      id: "local-site",
      name: project.site.name,
      domain,
      published: false,
      stats: { visits: 0, inquiries: 0 },
    },
    ...created,
  ];
}

export async function createSite(projectId: string, name: string): Promise<SiteSummary> {
  const reg = loadRegistry();
  const site: SiteSummary = {
    id: `site-${Date.now()}`,
    name,
    domain: "",
    published: false,
    stats: { visits: 0, inquiries: 0 },
  };
  (reg.sites[projectId] ??= []).push(site);
  saveRegistry(reg);
  return site;
}

export async function loadSiteStats(): Promise<SiteStats> {
  return { visits: 0, inquiries: 0, pages: 0, visitSeries: [], recentInquiries: [] };
}

export async function listThemes(): Promise<ThemeSummary[]> {
  const project = await loadProject();
  const name = (project.theme.config as { name?: string } | undefined)?.name ?? "テーマ";
  return [{ id: "current", name: String(name), description: "", current: true }];
}

function themeFiles(theme: ThemeBundle): Record<string, string> {
  const files: Record<string, string> = {};
  if (theme.layout) files["layout.html"] = theme.layout;
  for (const [name, html] of Object.entries(theme.templates ?? {})) {
    files[`templates/${name}.html`] = html;
  }
  for (const [name, html] of Object.entries(theme.sections ?? {})) {
    files[`sections/${name}.html`] = html;
  }
  files["theme.json"] = JSON.stringify(theme.config ?? {}, null, 2);
  return files;
}

function fileKind(path: string): ThemeFileKind {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  return "other";
}

export async function listThemeFiles(): Promise<ThemeFileNode[]> {
  const project = await loadProject();
  const base = themeFiles(project.theme);
  const paths = new Set([...Object.keys(base), ...themeOverlay.keys()]);
  return [...paths].sort().map((path) => {
    const original = path in base;
    return {
      path,
      kind: fileKind(path),
      custom: !original,
      edited: original && themeOverlay.has(path),
    };
  });
}

export async function readThemeFile(path: string): Promise<string> {
  if (themeOverlay.has(path)) return themeOverlay.get(path) ?? "";
  const project = await loadProject();
  return themeFiles(project.theme)[path] ?? "";
}

export async function writeThemeFile(path: string, content: string): Promise<void> {
  // Working copy only — the original theme files on disk are left untouched.
  themeOverlay.set(path, content);
}

/**
 * Overlay the code-editor working copy onto a loaded project's theme, so parts
 * created or edited in the code editor show in the visual editor and preview.
 * Applied to loadProject's result; the files on disk are untouched.
 */
export function applyThemeOverlay(project: ProjectData): ProjectData {
  if (themeOverlay.size === 0) return project;
  const theme: ThemeBundle = {
    ...project.theme,
    sections: { ...project.theme.sections },
    templates: { ...project.theme.templates },
  };
  let previewCss = project.previewCss;
  for (const [path, content] of themeOverlay) {
    const sec = /^sections\/(.+)\.html$/.exec(path);
    if (sec?.[1]) {
      theme.sections = { ...theme.sections, [sec[1]]: content };
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

export async function deleteThemeFile(path: string): Promise<void> {
  themeOverlay.delete(path);
}

export async function renameThemeFile(from: string, to: string): Promise<void> {
  const project = await loadProject();
  const base = themeFiles(project.theme);
  // Only created parts (in the overlay, not original theme files) can be renamed.
  if (from in base || to in base || themeOverlay.has(to)) return;
  const stem = (p: string) => p.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  themeOverlay.set(to, renameSection(themeOverlay.get(from) ?? "", stem(from), stem(to)));
  themeOverlay.delete(from);
}

export async function resetTheme(): Promise<void> {
  themeOverlay.clear();
}

// Contact forms. Stored in-session for the local build; the cloud receiver and
// forms.json persistence are wired later.
const formStore = new Map<string, FormDef>();

export async function listForms(): Promise<FormDef[]> {
  return [...formStore.values()];
}

export async function saveForms(forms: FormDef[]): Promise<void> {
  formStore.clear();
  for (const f of forms) formStore.set(f.id, f);
}

export async function listSubmissions(_formId: string): Promise<FormSubmission[]> {
  return [];
}
