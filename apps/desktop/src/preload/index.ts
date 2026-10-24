import { contextBridge, ipcRenderer } from "electron";
import type {
  ContentItem,
  ContentTypeDef,
  MenuItem,
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
  listSites: (projectId: string) => ipcRenderer.invoke("pcms:listSites", projectId),
  loadSiteStats: (siteId: string) => ipcRenderer.invoke("pcms:loadSiteStats", siteId),
  listThemes: () => ipcRenderer.invoke("pcms:listThemes"),
  listThemeFiles: () => ipcRenderer.invoke("pcms:listThemeFiles"),
  readThemeFile: (path: string) => ipcRenderer.invoke("pcms:readThemeFile", path),
  writeThemeFile: (path: string, content: string) =>
    ipcRenderer.invoke("pcms:writeThemeFile", path, content),
};

contextBridge.exposeInMainWorld("pcms", api);
