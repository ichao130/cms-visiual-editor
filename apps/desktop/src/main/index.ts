import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { ContentItem, ContentTypeDef, SiteSettings } from "@pcms/shared";
import type { MediaUpload } from "@pcms/editor-ui";
import {
  loadProject,
  saveDraft,
  saveContent,
  saveContentTypes,
  deleteContent,
  listMedia,
  saveMedia,
} from "./project.js";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "pcms テーマエディタ",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // Hardened defaults required by CLAUDE.md セキュリティ.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Keep navigation inside the app; open external links in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));

  return win;
}

/**
 * Env-gated boot check (PCMS_SMOKE=1): confirm the renderer mounted the editor
 * via window.pcms, then exit. Used only for automated verification; it has no
 * effect on the shipped app.
 */
function runSmokeCheck(win: BrowserWindow): void {
  win.webContents.on("did-finish-load", () => {
    void (async () => {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const rows = (await win.webContents.executeJavaScript(
          "(!!window.pcms && !!document.querySelector('.pcms-columns')) ? document.querySelectorAll('.pcms-section-row').length : -1",
        )) as number;
        console.log(`PCMS_SMOKE_RESULT sections=${rows}`);
        app.exit(rows > 0 ? 0 : 2);
      } catch (err) {
        console.log(`PCMS_SMOKE_ERROR ${String(err)}`);
        app.exit(3);
      }
    })();
  });
}

function registerIpc(): void {
  ipcMain.handle("pcms:loadProject", () => loadProject());
  ipcMain.handle("pcms:saveDraft", (_event, settings: SiteSettings) =>
    saveDraft(settings),
  );
  ipcMain.handle("pcms:saveContent", (_event, content: ContentItem[]) =>
    saveContent(content),
  );
  ipcMain.handle("pcms:saveContentTypes", (_event, types: ContentTypeDef[]) =>
    saveContentTypes(types),
  );
  ipcMain.handle("pcms:deleteContent", (_event, type: string, slug: string) =>
    deleteContent(type, slug),
  );
  ipcMain.handle("pcms:listMedia", () => listMedia());
  ipcMain.handle("pcms:saveMedia", (_event, files: MediaUpload[]) =>
    saveMedia(files),
  );
}

void app.whenReady().then(() => {
  registerIpc();
  const win = createWindow();
  if (process.env.PCMS_SMOKE === "1") runSmokeCheck(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
