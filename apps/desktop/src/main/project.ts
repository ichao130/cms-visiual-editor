import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";
import type { SiteSettings } from "@pcms/shared";
import type { ProjectData } from "@pcms/editor-ui";

/**
 * Filesystem-backed project data for the desktop app. This is the ONLY place
 * that touches the disk (CLAUDE.md: Electron固有処理は main に閉じ込める). The
 * renderer reaches it solely through window.pcms over IPC.
 *
 * Theme files are read-only; the operator's edits live in settings.json under
 * the app's user-data directory, so the bundled theme is never modified.
 */

function themeDir(): string {
  if (process.env.PCMS_THEME_DIR) return process.env.PCMS_THEME_DIR;
  // From out/main back up to the repo root, then themes/sample-cafe.
  return resolve(__dirname, "../../../..", "themes/sample-cafe");
}

function siteDir(): string {
  const dir = join(app.getPath("userData"), "site");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsPath(): string {
  return join(siteDir(), "settings.json");
}

const defaultSettings: SiteSettings = {
  pages: {
    index: {
      fields: {
        "hero.heading": "朝の一杯を、ていねいに。",
        "hero.lead": "駅前の小さな自家焙煎珈琲店です。",
        "hero.cta_label": "メニューを見る",
        "hero.cta_url": "/page/about/",
        "news.title": "お知らせ",
        "menu.title": "ドリンク",
      },
      sections: [
        {
          id: "menu",
          repeats: {
            items: [
              { name: "ブレンドコーヒー", price: "480円", note: "やさしい口当たり。" },
              { name: "カフェラテ", price: "550円", note: "" },
            ],
          },
        },
      ],
    },
  },
};

function readTheme(rel: string): string {
  return readFileSync(join(themeDir(), rel), "utf8");
}

function loadSettings(): SiteSettings {
  const path = settingsPath();
  if (!existsSync(path)) return defaultSettings;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SiteSettings;
  } catch {
    return defaultSettings;
  }
}

export function loadProject(): ProjectData {
  return {
    site: {
      name: "テスト珈琲店",
      baseUrl: "https://example.test",
      permalink: "/:type/:slug/",
    },
    settings: loadSettings(),
    theme: {
      config: JSON.parse(readTheme("theme.json")),
      layout: readTheme("layout.html"),
      templates: {
        index: readTheme("templates/index.html"),
        page: readTheme("templates/page.html"),
        post: readTheme("templates/post.html"),
      },
      assets: ["assets/style.css"],
    },
    content: [
      { type: "post", slug: "open", fields: { title: "開店しました", date: "2026-02-01" }, body: "" },
      { type: "post", slug: "hours", fields: { title: "営業時間のお知らせ", date: "2026-02-10" }, body: "" },
      { type: "page", slug: "about", fields: { title: "お店について" }, body: "" },
    ],
    menus: {
      menu: [
        { label: "ホーム", url: "/" },
        { label: "お知らせ", url: "/post/open/" },
      ],
    },
    contentTypes: [],
    previewCss: readTheme("assets/style.css"),
  };
}

export function saveDraft(settings: SiteSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}
