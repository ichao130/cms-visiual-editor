import { contextBridge, ipcRenderer } from "electron";
import type {
  ContentItem,
  ContentTypeDef,
  MenuItem,
  SiteSettings,
} from "@pcms/shared";
import type { MediaUpload, PcmsApi } from "@pcms/editor-ui";

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
  deleteContent: (type: string, slug: string) =>
    ipcRenderer.invoke("pcms:deleteContent", type, slug),
  listMedia: () => ipcRenderer.invoke("pcms:listMedia"),
  saveMedia: (files: MediaUpload[]) => ipcRenderer.invoke("pcms:saveMedia", files),
};

contextBridge.exposeInMainWorld("pcms", api);
