import { contextBridge, ipcRenderer } from "electron";
import type { SiteSettings } from "@pcms/shared";
import type { PcmsApi } from "@pcms/editor-ui";

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
};

contextBridge.exposeInMainWorld("pcms", api);
