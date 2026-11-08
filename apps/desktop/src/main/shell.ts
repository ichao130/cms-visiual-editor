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
import type { FormDef, FormSubmission, VisitStats } from "@pcms/shared";
import {
  renameSection,
  isBinaryAsset,
  assetContentType,
  bytesToDataUrl,
} from "@pcms/engine";
import {
  loadProject,
  listThemes as loadThemes,
  createTheme as createThemeOnDisk,
  setActiveTheme as setActiveThemeOnDisk,
} from "./project.js";
import {
  overlayDelete,
  overlayGet,
  overlayHas,
  overlayKeys,
  overlaySet,
  overlayClear,
} from "./theme-overlay.js";
import { callFunction, NotSignedInError } from "./functions.js";
import { currentUid } from "./auth.js";
import { loadFirebaseConfig } from "./cloud.js";
import { patchDocument, runQuery } from "./firestore.js";

/** The built-in local project/site, always present. */
const LOCAL_PROJECT_ID = "local";

interface ShellRegistry {
  projects: ProjectSummary[];
  sites: Record<string, SiteSummary[]>;
  /** Tombstones for the built-in local project/site. */
  deletedProjects?: string[];
  deletedSites?: string[];
  /** Name overrides (the built-in entities are derived; created ones use these too). */
  projectNames?: Record<string, string>;
  siteNames?: Record<string, string>;
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
 * file edits are kept in a persisted working copy (see theme-overlay) so the
 * theme files on disk are never modified (CLAUDE.md: テーマのファイルは改変しない).
 */

export async function loadAccount(): Promise<AccountView> {
  return { name: "ローカルユーザー", email: "local@pcms", plan: "ローカル", ai: { used: 0, limit: 100 } };
}

async function sitesForProject(reg: ShellRegistry, projectId: string): Promise<SiteSummary[]> {
  const deleted = new Set(reg.deletedSites ?? []);
  const names = reg.siteNames ?? {};
  const rename = (s: SiteSummary): SiteSummary => {
    const name = names[s.id];
    return name ? { ...s, name } : s;
  };
  const created = (reg.sites[projectId] ?? []).filter((s) => !deleted.has(s.id)).map(rename);
  if (projectId !== LOCAL_PROJECT_ID) return created;

  const project = await loadProject();
  const baseUrl = project.site.baseUrl ?? "";
  let domain = baseUrl;
  try {
    domain = new URL(baseUrl).host;
  } catch {
    domain = baseUrl;
  }
  const local: SiteSummary = {
    id: "local-site",
    name: project.site.name,
    domain,
    published: false,
    stats: { visits: 0, inquiries: 0 },
  };
  return deleted.has(local.id) ? created : [rename(local), ...created];
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const reg = loadRegistry();
  const deleted = new Set(reg.deletedProjects ?? []);
  const names = reg.projectNames ?? {};
  const local: ProjectSummary = { id: LOCAL_PROJECT_ID, name: "ローカルプロジェクト", siteCount: 0 };
  const projects = [local, ...reg.projects].filter((p) => !deleted.has(p.id));
  return Promise.all(
    projects.map(async (p) => ({
      ...p,
      name: names[p.id] ?? p.name,
      siteCount: (await sitesForProject(reg, p.id)).length,
    })),
  );
}

export async function createProject(name: string): Promise<ProjectSummary> {
  const reg = loadRegistry();
  const project: ProjectSummary = { id: `proj-${Date.now()}`, name, siteCount: 0 };
  reg.projects.push(project);
  saveRegistry(reg);
  return project;
}

export async function deleteProject(projectId: string): Promise<void> {
  const reg = loadRegistry();
  const wasCreated = reg.projects.some((p) => p.id === projectId);
  reg.projects = reg.projects.filter((p) => p.id !== projectId);
  if (!wasCreated) {
    reg.deletedProjects = [...new Set([...(reg.deletedProjects ?? []), projectId])];
  }
  saveRegistry(reg);
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const reg = loadRegistry();
  (reg.projectNames ??= {})[projectId] = name;
  saveRegistry(reg);
}

export async function listSites(projectId: string): Promise<SiteSummary[]> {
  return sitesForProject(loadRegistry(), projectId);
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

export async function deleteSite(projectId: string, siteId: string): Promise<void> {
  const reg = loadRegistry();
  const list = reg.sites[projectId] ?? [];
  const wasCreated = list.some((s) => s.id === siteId);
  reg.sites[projectId] = list.filter((s) => s.id !== siteId);
  if (!wasCreated) {
    reg.deletedSites = [...new Set([...(reg.deletedSites ?? []), siteId])];
  }
  saveRegistry(reg);
}

export async function renameSite(_projectId: string, siteId: string, name: string): Promise<void> {
  const reg = loadRegistry();
  (reg.siteNames ??= {})[siteId] = name;
  saveRegistry(reg);
}

export async function loadSiteStats(): Promise<SiteStats> {
  return { visits: 0, inquiries: 0, pages: 0, visitSeries: [], recentInquiries: [] };
}

/**
 * Visit stats for the dashboard, read through the Firebase `visitStats` callable
 * (GA4 / MOKKEDA server-side; the function falls back to a mock series until
 * those secrets are set). When the operator isn't signed in — or the cloud is
 * unreachable — return an empty, clearly-sourced result so the UI never shows
 * fabricated numbers.
 */
export async function fetchVisitStats(siteId: string, days = 14): Promise<VisitStats> {
  const span = Math.min(90, Math.max(1, Math.trunc(days)));
  try {
    return await callFunction<VisitStats>("visitStats", { siteId, days: span });
  } catch (err) {
    if (!(err instanceof NotSignedInError)) console.error("fetchVisitStats failed", err);
    return { total: 0, series: [], source: "mock", days: span };
  }
}

export async function listThemes(): Promise<ThemeSummary[]> {
  return loadThemes();
}

export async function createTheme(
  meta: { name: string; description?: string; source?: string },
  files: Record<string, string>,
): Promise<ThemeSummary> {
  return createThemeOnDisk(meta, files);
}

export async function setActiveTheme(id: string): Promise<void> {
  setActiveThemeOnDisk(id);
}

function themeFiles(project: ProjectData): Record<string, string> {
  const theme = project.theme;
  const files: Record<string, string> = {};
  if (theme.layout) files["layout.html"] = theme.layout;
  for (const [name, html] of Object.entries(theme.templates ?? {})) {
    files[`templates/${name}.html`] = html;
  }
  for (const [name, html] of Object.entries(theme.sections ?? {})) {
    files[`sections/${name}.html`] = html;
  }
  for (const [name, html] of Object.entries(theme.blocks ?? {})) {
    files[`blocks/${name}.html`] = html;
  }
  files["theme.json"] = JSON.stringify(theme.config ?? {}, null, 2);
  // The stylesheet, so the code editor can edit site-wide CSS directly.
  files["assets/style.css"] = project.previewCss ?? "";
  // Binary assets (images/fonts) as data URLs, so the editor can list/preview
  // them. Operator-added assets also surface via the overlay (see below).
  for (const [path, dataUrl] of Object.entries(project.themeAssets ?? {})) {
    files[path] = dataUrl;
  }
  return files;
}

function fileKind(path: string): ThemeFileKind {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  if (isBinaryAsset(path)) return "image";
  return "other";
}

export async function listThemeFiles(): Promise<ThemeFileNode[]> {
  const project = await loadProject();
  const base = themeFiles(project);
  const paths = new Set([...Object.keys(base), ...overlayKeys()]);
  return [...paths].sort().map((path) => {
    const original = path in base;
    return {
      path,
      kind: fileKind(path),
      custom: !original,
      edited: original && overlayHas(path),
      binary: isBinaryAsset(path),
    };
  });
}

export async function readThemeFile(path: string): Promise<string> {
  if (overlayHas(path)) return overlayGet(path) ?? "";
  const project = await loadProject();
  return themeFiles(project)[path] ?? "";
}

export async function writeThemeFile(path: string, content: string): Promise<void> {
  // Working copy only — the original theme files on disk are left untouched.
  overlaySet(path, content);
}

export async function writeThemeAsset(path: string, bytes: Uint8Array): Promise<void> {
  // The overlay store is string-only, so a binary asset is kept as a data URL.
  overlaySet(path, bytesToDataUrl(bytes, assetContentType(path)));
}

export async function deleteThemeFile(path: string): Promise<void> {
  overlayDelete(path);
}

export async function renameThemeFile(from: string, to: string): Promise<void> {
  const project = await loadProject();
  const base = themeFiles(project);
  // Only created parts (in the overlay, not original theme files) can be renamed.
  if (from in base || to in base || overlayHas(to)) return;
  const stem = (p: string) => p.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  const content = overlayGet(from) ?? "";
  // HTML parts keep their data-section id in step; other files just move.
  overlaySet(to, from.endsWith(".html") ? renameSection(content, stem(from), stem(to)) : content);
  overlayDelete(from);
}

export async function resetTheme(): Promise<void> {
  overlayClear();
}

// Contact forms. Kept in-session for the builder; when the operator is signed
// in they are also synced to Firestore so the cloud receiver (submitForm) will
// accept posts and the owner can read the submissions back.
const formStore = new Map<string, FormDef>();

/** The cloud key for a local site: scoped by uid so it's globally unique + owned. */
function cloudSiteId(localSiteId: string): string | null {
  const uid = currentUid();
  return uid ? `${uid}-${localSiteId}` : null;
}

async function siteDisplayName(): Promise<string | undefined> {
  try {
    const name = (await loadProject()).site?.name;
    return typeof name === "string" && name.trim() !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Shape a FormDef as the FormConfig document the receiver + rules expect. */
function toFormConfig(form: FormDef, siteName?: string): Record<string, unknown> {
  return {
    name: form.name,
    siteName,
    fields: form.fields.map((f) => ({
      name: f.name,
      label: f.label,
      required: Boolean(f.required),
      type: f.type,
    })),
    notifyEmails: form.notifyEmails,
    autoReply: form.autoReply,
    completionMessage: form.completionMessage,
    storeSubmission: true,
  };
}

export async function listForms(): Promise<FormDef[]> {
  return [...formStore.values()];
}

export async function saveForms(siteId: string, forms: FormDef[]): Promise<void> {
  formStore.clear();
  for (const f of forms) formStore.set(f.id, f);

  // Best-effort cloud sync: register the site (ownerId) and each form so that
  // submitForm accepts posts and the owner may read submissions. A failure or
  // being signed out must not break the local save.
  const cloudId = cloudSiteId(siteId);
  const uid = currentUid();
  if (!cloudId || !uid) return;
  try {
    const siteName = await siteDisplayName();
    await patchDocument(`sites/${cloudId}`, { ownerId: uid, siteName });
    for (const form of forms) {
      await patchDocument(`sites/${cloudId}/forms/${form.id}`, toFormConfig(form, siteName));
    }
  } catch (err) {
    console.error("form cloud sync failed", err);
  }
}

export async function listSubmissions(siteId: string, formId: string): Promise<FormSubmission[]> {
  const cloudId = cloudSiteId(siteId);
  if (!cloudId) return [];
  try {
    const docs = await runQuery(`sites/${cloudId}`, "submissions", "formId", formId);
    return docs
      .map((doc) => {
        const data = doc.data as { formId?: string; fields?: Record<string, unknown>; createdAt?: unknown };
        const values: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.fields ?? {})) values[k] = String(v ?? "");
        const receivedAt = typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString();
        return {
          id: doc.id,
          formId: String(data.formId ?? formId),
          values,
          receivedAt,
        } satisfies FormSubmission;
      })
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  } catch (err) {
    if (!(err instanceof NotSignedInError)) console.error("listSubmissions failed", err);
    return [];
  }
}

/**
 * The live submitForm endpoint + the cloud siteId for the embed snippet, so the
 * deployed form posts to the same place saveForms registered. Null when the
 * operator isn't signed in / cloud isn't configured (the UI shows a placeholder).
 */
export async function cloudFormTarget(
  siteId: string,
): Promise<{ endpoint: string; siteId: string } | null> {
  const config = loadFirebaseConfig();
  const cloudId = cloudSiteId(siteId);
  if (!config || !cloudId) return null;
  return {
    endpoint: `https://us-central1-${config.projectId}.cloudfunctions.net/submitForm`,
    siteId: cloudId,
  };
}
