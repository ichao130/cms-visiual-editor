import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import {
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
} from "@pcms/engine";
import type {
  ContentItem,
  ContentTypeDef,
  FormDef,
  MenuItem,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import type { MediaUpload } from "@pcms/editor-ui";
import {
  loadProject,
  saveDraft,
  saveContent,
  saveContentTypes,
  saveMenus,
  saveTaxonomies,
  deleteContent,
  listMedia,
  saveMedia,
} from "./project.js";
import {
  getDeployConfig,
  setDeployConfig,
  previewPublish,
  publishSite,
  listPublishHistory,
  rollbackPublish,
  type DeployConfigInput,
} from "./publish.js";
import {
  loadAccount,
  listProjects,
  listSites,
  loadSiteStats,
  listThemes,
  listThemeFiles,
  readThemeFile,
  writeThemeFile,
  deleteThemeFile,
  renameThemeFile,
  resetTheme,
  listForms,
  saveForms,
  listSubmissions,
} from "./shell.js";

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
        const result = (await win.webContents.executeJavaScript(
          `(async () => {
            // The app opens on the dashboard (project cards).
            const cards = document.querySelectorAll('.pcms-card').length;
            const hasPcms = !!window.pcms;
            let upload = -1;
            try { upload = (await window.pcms.previewPublish()).upload; }
            catch (e) { upload = 'ERR:' + (e && e.message); }
            return JSON.stringify({ cards, hasPcms, upload });
          })()`,
        )) as string;
        console.log(`PCMS_SMOKE_RESULT ${result}`);
        const parsed = JSON.parse(result) as { cards: number; hasPcms: boolean; upload: number };
        const ok = parsed.hasPcms && parsed.cards > 0 && typeof parsed.upload === "number" && parsed.upload > 0;
        app.exit(ok ? 0 : 2);
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
  ipcMain.handle(
    "pcms:saveMenus",
    (_event, menus: Record<string, MenuItem[]>) => saveMenus(menus),
  );
  ipcMain.handle("pcms:saveTaxonomies", (_event, taxonomies: TaxonomyDef[]) =>
    saveTaxonomies(taxonomies),
  );
  ipcMain.handle("pcms:deleteContent", (_event, type: string, slug: string) =>
    deleteContent(type, slug),
  );
  ipcMain.handle("pcms:listMedia", () => listMedia());
  ipcMain.handle("pcms:saveMedia", (_event, files: MediaUpload[]) =>
    saveMedia(files),
  );

  ipcMain.handle("pcms:getDeployConfig", () => getDeployConfig());
  ipcMain.handle("pcms:setDeployConfig", (_event, config: DeployConfigInput) =>
    setDeployConfig(config),
  );
  ipcMain.handle("pcms:previewPublish", () => previewPublish());
  ipcMain.handle("pcms:publishSite", () => publishSite());
  ipcMain.handle("pcms:listPublishHistory", () => listPublishHistory());
  ipcMain.handle("pcms:rollbackPublish", (_event, id: string) =>
    rollbackPublish(id),
  );

  // AI assist. Offline heuristics for the evaluation build; a real build would
  // forward these to the Firebase AI proxy (no API key in the app).
  ipcMain.handle("pcms:aiThemeify", (_event, html: string) => {
    const themed = themeifyHtml(html);
    return { html: themed, issues: validateThemeHtml(themed) };
  });
  ipcMain.handle("pcms:aiDraft", (_event, prompt: string) => draftText(prompt));
  ipcMain.handle("pcms:aiRewrite", (_event, text: string, instruction: string) =>
    rewriteText(text, instruction),
  );
  ipcMain.handle("pcms:aiSeo", (_event, title: string, bodyHtml: string) =>
    seoSuggest(title, bodyHtml),
  );

  // App shell (local single-project view; cloud account/analytics wired later).
  ipcMain.handle("pcms:loadAccount", () => loadAccount());
  ipcMain.handle("pcms:listProjects", () => listProjects());
  ipcMain.handle("pcms:listSites", (_event, _projectId: string) => listSites());
  ipcMain.handle("pcms:loadSiteStats", (_event, _siteId: string) => loadSiteStats());
  ipcMain.handle("pcms:listThemes", () => listThemes());
  ipcMain.handle("pcms:listThemeFiles", () => listThemeFiles());
  ipcMain.handle("pcms:readThemeFile", (_event, path: string) => readThemeFile(path));
  ipcMain.handle("pcms:writeThemeFile", (_event, path: string, content: string) =>
    writeThemeFile(path, content),
  );
  ipcMain.handle("pcms:deleteThemeFile", (_event, path: string) => deleteThemeFile(path));
  ipcMain.handle("pcms:renameThemeFile", (_event, from: string, to: string) =>
    renameThemeFile(from, to),
  );
  ipcMain.handle("pcms:resetTheme", () => resetTheme());
  ipcMain.handle("pcms:listForms", () => listForms());
  ipcMain.handle("pcms:saveForms", (_event, forms: FormDef[]) => saveForms(forms));
  ipcMain.handle("pcms:listSubmissions", (_event, formId: string) => listSubmissions(formId));
}

/**
 * Check for updates in the background. Only in a packaged build — never in dev
 * or the smoke check — and it needs the publish feed configured in
 * electron-builder.yml (electron-updater).
 */
function maybeCheckForUpdates(): void {
  if (!app.isPackaged || process.env.PCMS_SMOKE === "1") return;
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error("update check failed", err);
  });
}

void app.whenReady().then(() => {
  registerIpc();
  const win = createWindow();
  if (process.env.PCMS_SMOKE === "1") runSmokeCheck(win);
  else maybeCheckForUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
