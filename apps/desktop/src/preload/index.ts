import { contextBridge, ipcRenderer } from "electron";
import type {
  ContentItem,
  ContentTypeDef,
  FormDef,
  MenuItem,
  Redirect,
  SiteConfig,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import type { DeployConfigInput, MediaUpload, PcmsApi } from "@pcms/editor-ui";

/**
 * The preload exposes a minimal, explicit API over IPC — no generic
 * "read any path" / "run any command" surface (CLAUDE.md セキュリティ). It runs
 * sandboxed with contextIsolation, so it only forwards calls to the main
 * process; all filesystem work happens there.
 */
const api: PcmsApi = {
  loadProject: () => ipcRenderer.invoke("pcms:loadProject"),
  saveSite: (site: SiteConfig) => ipcRenderer.invoke("pcms:saveSite", site),
  saveDraft: (settings: SiteSettings) =>
    ipcRenderer.invoke("pcms:saveDraft", settings),
  saveContent: (content: ContentItem[]) =>
    ipcRenderer.invoke("pcms:saveContent", content),
  saveContentTypes: (types: ContentTypeDef[]) =>
    ipcRenderer.invoke("pcms:saveContentTypes", types),
  saveMenus: (menus: Record<string, MenuItem[]>) =>
    ipcRenderer.invoke("pcms:saveMenus", menus),
  saveTaxonomies: (taxonomies: TaxonomyDef[]) =>
    ipcRenderer.invoke("pcms:saveTaxonomies", taxonomies),
  deleteContent: (type: string, slug: string) =>
    ipcRenderer.invoke("pcms:deleteContent", type, slug),
  listMedia: () => ipcRenderer.invoke("pcms:listMedia"),
  saveMedia: (files: MediaUpload[]) => ipcRenderer.invoke("pcms:saveMedia", files),
  deleteMedia: (path: string) => ipcRenderer.invoke("pcms:deleteMedia", path),
  setMediaAlt: (path: string, alt: string) =>
    ipcRenderer.invoke("pcms:setMediaAlt", path, alt),
  getDeployConfig: () => ipcRenderer.invoke("pcms:getDeployConfig"),
  setDeployConfig: (config: DeployConfigInput) =>
    ipcRenderer.invoke("pcms:setDeployConfig", config),
  previewPublish: () => ipcRenderer.invoke("pcms:previewPublish"),
  publishSite: () => ipcRenderer.invoke("pcms:publishSite"),
  listPublishHistory: () => ipcRenderer.invoke("pcms:listPublishHistory"),
  rollbackPublish: (id: string) => ipcRenderer.invoke("pcms:rollbackPublish", id),
  aiThemeify: (html: string) => ipcRenderer.invoke("pcms:aiThemeify", html),
  aiDraft: (prompt: string) => ipcRenderer.invoke("pcms:aiDraft", prompt),
  aiRewrite: (text: string, instruction: string) =>
    ipcRenderer.invoke("pcms:aiRewrite", text, instruction),
  aiSeo: (title: string, bodyHtml: string) =>
    ipcRenderer.invoke("pcms:aiSeo", title, bodyHtml),
  loadAccount: () => ipcRenderer.invoke("pcms:loadAccount"),
  listProjects: () => ipcRenderer.invoke("pcms:listProjects"),
  createProject: (name: string) => ipcRenderer.invoke("pcms:createProject", name),
  deleteProject: (projectId: string) => ipcRenderer.invoke("pcms:deleteProject", projectId),
  renameProject: (projectId: string, name: string) =>
    ipcRenderer.invoke("pcms:renameProject", projectId, name),
  listSites: (projectId: string) => ipcRenderer.invoke("pcms:listSites", projectId),
  createSite: (projectId: string, name: string) =>
    ipcRenderer.invoke("pcms:createSite", projectId, name),
  deleteSite: (projectId: string, siteId: string) =>
    ipcRenderer.invoke("pcms:deleteSite", projectId, siteId),
  renameSite: (projectId: string, siteId: string, name: string) =>
    ipcRenderer.invoke("pcms:renameSite", projectId, siteId, name),
  loadSiteStats: (siteId: string) => ipcRenderer.invoke("pcms:loadSiteStats", siteId),
  listThemes: () => ipcRenderer.invoke("pcms:listThemes"),
  listThemeFiles: () => ipcRenderer.invoke("pcms:listThemeFiles"),
  readThemeFile: (path: string) => ipcRenderer.invoke("pcms:readThemeFile", path),
  writeThemeFile: (path: string, content: string) =>
    ipcRenderer.invoke("pcms:writeThemeFile", path, content),
  deleteThemeFile: (path: string) => ipcRenderer.invoke("pcms:deleteThemeFile", path),
  renameThemeFile: (from: string, to: string) =>
    ipcRenderer.invoke("pcms:renameThemeFile", from, to),
  resetTheme: () => ipcRenderer.invoke("pcms:resetTheme"),
  listForms: () => ipcRenderer.invoke("pcms:listForms"),
  saveForms: (forms: FormDef[]) => ipcRenderer.invoke("pcms:saveForms", forms),
  listSubmissions: (formId: string) => ipcRenderer.invoke("pcms:listSubmissions", formId),
  loadRedirects: () => ipcRenderer.invoke("pcms:loadRedirects"),
  saveRedirects: (redirects: Redirect[]) => ipcRenderer.invoke("pcms:saveRedirects", redirects),
};

contextBridge.exposeInMainWorld("pcms", api);
