import type {
  ContentItem,
  ContentTypeDef,
  MediaItem,
  MenuItem,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import { BUILTIN_CONTENT_TYPES, BUILTIN_TAXONOMIES } from "@pcms/shared";
import {
  generateSite,
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
} from "@pcms/engine";
import type { ThemeBundle } from "@pcms/engine";
import type {
  AccountView,
  DeployConfigView,
  MediaUpload,
  PcmsApi,
  ProjectData,
  ProjectSummary,
  PublishHistoryEntry,
  PublishPreview,
  PublishReport,
  SiteStats,
  SiteSummary,
  ThemeFileKind,
  ThemeFileNode,
  ThemeSummary,
} from "./types.js";

// Read the sample-cafe theme at build time as raw strings (Vite ?raw). This
// keeps the dev harness free of any filesystem access at runtime.
import layout from "../../../../themes/sample-cafe/layout.html?raw";
import indexTpl from "../../../../themes/sample-cafe/templates/index.html?raw";
import pageTpl from "../../../../themes/sample-cafe/templates/page.html?raw";
import postTpl from "../../../../themes/sample-cafe/templates/post.html?raw";
import archiveTpl from "../../../../themes/sample-cafe/templates/archive.html?raw";
import secHero from "../../../../themes/sample-cafe/sections/hero.html?raw";
import secNews from "../../../../themes/sample-cafe/sections/news.html?raw";
import secMenu from "../../../../themes/sample-cafe/sections/menu.html?raw";
import secGallery from "../../../../themes/sample-cafe/sections/gallery.html?raw";
import secText from "../../../../themes/sample-cafe/sections/text.html?raw";

import themeJson from "../../../../themes/sample-cafe/theme.json";
import previewCss from "../../../../themes/sample-cafe/assets/style.css?raw";

const DRAFT_KEY = "pcms.mock.draft";
const CONTENT_KEY = "pcms.mock.content";
const MEDIA_KEY = "pcms.mock.media";
const TYPES_KEY = "pcms.mock.types";
const TAX_KEY = "pcms.mock.taxonomies";
const MENUS_KEY = "pcms.mock.menus";

const defaultMenus: Record<string, MenuItem[]> = {
  menu: [
    { label: "ホーム", url: "/" },
    { label: "お知らせ", url: "/post/open/" },
  ],
};

function svgDataUrl(label: string, color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='${color}'/><text x='160' y='108' font-size='24' text-anchor='middle' fill='#fff' font-family='sans-serif'>${label}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

const defaultMedia: MediaItem[] = [
  { id: "sample-beans", fileName: "sample-beans.svg", path: "media/sample-beans.svg", width: 320, height: 200, dataUrl: svgDataUrl("サンプル：豆", "#5a3e2b") },
  { id: "sample-cup", fileName: "sample-cup.svg", path: "media/sample-cup.svg", width: 320, height: 200, dataUrl: svgDataUrl("サンプル：カップ", "#c98a3b") },
];

function bytesToWebpDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/webp;base64,${btoa(binary)}`;
}

const defaultContent: ContentItem[] = [
  { type: "post", slug: "open", fields: { title: "開店しました", date: "2026-02-01" }, body: "<h2>ごあいさつ</h2><p>本日<strong>開店</strong>しました。ぜひお立ち寄りください。</p>" },
  { type: "post", slug: "hours", fields: { title: "営業時間のお知らせ", date: "2026-02-10" }, body: "<p>平日は <em>9時</em> から営業します。</p><ul><li>月〜金 9:00-19:00</li><li>土日 10:00-18:00</li></ul>" },
  { type: "page", slug: "about", fields: { title: "お店について" }, body: "<p>小さな自家焙煎の珈琲店です。</p>" },
];

const defaultSettings: SiteSettings = {
  pages: {
    index: {
      instances: [
        {
          id: "hero-1",
          type: "hero",
          fields: {
            image: "media/sample-beans.svg",
            heading: "朝の一杯を、ていねいに。",
            lead: "駅前の小さな自家焙煎珈琲店です。",
            cta_label: "メニューを見る",
            cta_url: "/page/about/",
          },
        },
        { id: "news-1", type: "news", fields: { title: "お知らせ" } },
        {
          id: "menu-1",
          type: "menu",
          fields: { title: "ドリンク" },
          repeats: {
            items: [
              { name: "ブレンドコーヒー", price: "480円", note: "やさしい口当たり。" },
              { name: "カフェラテ", price: "550円", note: "" },
              { name: "本日のケーキ", price: "420円", note: "日替わりです。" },
            ],
          },
        },
        {
          id: "gallery-1",
          type: "gallery",
          fields: { title: "店内のようす" },
          repeats: {
            photos: [
              { image: "media/sample-beans.svg" },
              { image: "media/sample-cup.svg" },
            ],
          },
        },
      ],
    },
  },
};

function loadDraft(): SiteSettings | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as SiteSettings) : null;
  } catch {
    return null;
  }
}

function loadContent(): ContentItem[] {
  try {
    const raw = localStorage.getItem(CONTENT_KEY);
    return raw ? (JSON.parse(raw) as ContentItem[]) : defaultContent;
  } catch {
    return defaultContent;
  }
}

function loadMedia(): MediaItem[] {
  try {
    const raw = localStorage.getItem(MEDIA_KEY);
    return raw ? (JSON.parse(raw) as MediaItem[]) : defaultMedia;
  } catch {
    return defaultMedia;
  }
}

function loadTypes(): ContentTypeDef[] {
  try {
    const raw = localStorage.getItem(TYPES_KEY);
    return raw ? (JSON.parse(raw) as ContentTypeDef[]) : BUILTIN_CONTENT_TYPES;
  } catch {
    return BUILTIN_CONTENT_TYPES;
  }
}

function loadMenus(): Record<string, MenuItem[]> {
  try {
    const raw = localStorage.getItem(MENUS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, MenuItem[]>) : defaultMenus;
  } catch {
    return defaultMenus;
  }
}

function loadTaxonomies(): TaxonomyDef[] {
  try {
    const raw = localStorage.getItem(TAX_KEY);
    return raw ? (JSON.parse(raw) as TaxonomyDef[]) : BUILTIN_TAXONOMIES;
  } catch {
    return BUILTIN_TAXONOMIES;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage failures in the mock */
  }
}

const MOCK_TARGET = "ブラウザのモック（実際の送信は行いません）";

/** Count the pages the engine would generate — a real preview number. */
function outputCount(): number {
  const generated = generateSite({
    site: { name: "テスト珈琲店", baseUrl: "https://example.test", permalink: "/:type/:slug/" },
    settings: loadDraft() ?? defaultSettings,
    contentTypes: loadTypes(),
    content: loadContent(),
    theme: buildTheme(),
    menus: loadMenus(),
    taxonomies: loadTaxonomies(),
  });
  return Object.keys(generated.files).length;
}

// ---------------------------------------------------------------------------
// App-shell mock data (dashboard / projects / sites / themes)
// ---------------------------------------------------------------------------

const mockAccount: AccountView = {
  name: "珈琲店オーナー",
  email: "owner@example.test",
  plan: "スタンダード",
  ai: { used: 23, limit: 100 },
};

const mockProjects: ProjectSummary[] = [
  { id: "proj-cafe", name: "珈琲店サイト運用", siteCount: 2 },
  { id: "proj-clinic", name: "クリニック（準備中）", siteCount: 1 },
];

const mockSites: Record<string, SiteSummary[]> = {
  "proj-cafe": [
    { id: "site-cafe", name: "テスト珈琲店", domain: "example.test", published: true, stats: { visits: 1240, inquiries: 8 } },
    { id: "site-cafe-lp", name: "季節のキャンペーンLP", domain: "campaign.example.test", published: false, stats: { visits: 0, inquiries: 0 } },
  ],
  "proj-clinic": [
    { id: "site-clinic", name: "〇〇クリニック", domain: "clinic.example.test", published: false, stats: { visits: 0, inquiries: 0 } },
  ],
};

/** The site that the theme editor actually loads/edits (loadProject). */
const ACTIVE_SITE_ID = "site-cafe";

const mockInquiries = [
  { id: "inq-1", name: "田中 花子", email: "tanaka@example.com", message: "テイクアウトは可能ですか？", receivedAt: "2026-10-22T10:12:00Z" },
  { id: "inq-2", name: "佐藤 健", email: "sato@example.com", message: "豆の卸売についてご相談したいです。", receivedAt: "2026-10-21T15:40:00Z" },
  { id: "inq-3", name: "鈴木 一郎", email: "suzuki@example.com", message: "店内でイベントはできますか？", receivedAt: "2026-10-20T09:05:00Z" },
];

const mockThemes: ThemeSummary[] = [
  { id: "sample-cafe", name: "Sample Cafe", description: "カフェ・小規模店舗向けのサンプルテーマ。", current: true },
  { id: "minimal", name: "Minimal", description: "シンプルなブログ／コーポレート向け。", current: false },
  { id: "shop-starter", name: "Shop Starter", description: "商品一覧に強いスターターテーマ。", current: false },
];

// Theme source files, exposed to the code editor. Writes go to a localStorage
// working copy overlaid on these originals — the sample-cafe files are never
// modified (CLAUDE.md: テーマのファイルは改変しない).
const THEME_KEY = "pcms.mock.themeFiles";
const THEME_FILES: Record<string, string> = {
  "theme.json": JSON.stringify(themeJson, null, 2),
  "layout.html": layout,
  "templates/index.html": indexTpl,
  "templates/page.html": pageTpl,
  "templates/post.html": postTpl,
  "templates/archive.html": archiveTpl,
  "sections/hero.html": secHero,
  "sections/news.html": secNews,
  "sections/menu.html": secMenu,
  "sections/gallery.html": secGallery,
  "sections/text.html": secText,
  "assets/style.css": previewCss,
};

function themeWorkingCopy(): Record<string, string> {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function themeFileKind(path: string): ThemeFileKind {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  return "other";
}

/** Theme originals overlaid with the code-editor working copy. */
function mergedThemeFiles(): Record<string, string> {
  return { ...THEME_FILES, ...themeWorkingCopy() };
}

/**
 * Build the theme bundle from the merged files, so parts created or edited in
 * the code editor (sections/*.html, templates, layout, assets) flow into the
 * visual editor's section catalog and the preview.
 */
function buildTheme(): ThemeBundle {
  const files = mergedThemeFiles();
  const sections: Record<string, string> = {};
  const templates: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const sec = /^sections\/(.+)\.html$/.exec(path);
    if (sec?.[1]) {
      sections[sec[1]] = content;
      continue;
    }
    const tpl = /^templates\/(.+)\.html$/.exec(path);
    if (tpl?.[1]) templates[tpl[1]] = content;
  }
  let config = themeJson as ThemeBundle["config"];
  try {
    config = JSON.parse(files["theme.json"] ?? "") as ThemeBundle["config"];
  } catch {
    /* keep the imported theme.json */
  }
  return {
    config,
    layout: files["layout.html"] ?? layout,
    templates,
    sections,
    assets: ["assets/style.css"],
  };
}

/** Browser mock of window.pcms used by the dev harness. */
export function createMockApi(): PcmsApi {
  return {
    async loadProject(): Promise<ProjectData> {
      return {
        site: {
          name: "テスト珈琲店",
          baseUrl: "https://example.test",
          permalink: "/:type/:slug/",
        },
        settings: loadDraft() ?? defaultSettings,
        theme: buildTheme(),
        content: loadContent(),
        menus: loadMenus(),
        contentTypes: loadTypes(),
        taxonomies: loadTaxonomies(),
        previewCss: mergedThemeFiles()["assets/style.css"] ?? previewCss,
      };
    },
    async saveDraft(settings: SiteSettings): Promise<void> {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(settings));
      } catch {
        /* ignore storage failures in the mock */
      }
    },
    async saveContent(content: ContentItem[]): Promise<void> {
      saveJson(CONTENT_KEY, content);
    },
    async saveContentTypes(types: ContentTypeDef[]): Promise<void> {
      saveJson(TYPES_KEY, types);
    },
    async saveMenus(menus: Record<string, MenuItem[]>): Promise<void> {
      saveJson(MENUS_KEY, menus);
    },
    async saveTaxonomies(taxonomies: TaxonomyDef[]): Promise<void> {
      saveJson(TAX_KEY, taxonomies);
    },
    async getDeployConfig(): Promise<DeployConfigView> {
      return { type: "local", dir: MOCK_TARGET };
    },
    async setDeployConfig(): Promise<void> {
      /* no-op in the mock */
    },
    async previewPublish(): Promise<PublishPreview> {
      return { issues: [], upload: outputCount(), delete: 0, unchanged: 0, target: MOCK_TARGET };
    },
    async publishSite(): Promise<PublishReport> {
      return {
        ok: true,
        issues: [],
        uploaded: outputCount(),
        deleted: 0,
        unchanged: 0,
        target: MOCK_TARGET,
        publishedAt: new Date().toISOString(),
      };
    },
    async listPublishHistory(): Promise<PublishHistoryEntry[]> {
      return [];
    },
    async rollbackPublish(): Promise<PublishReport> {
      return { ok: true, issues: [], uploaded: 0, deleted: 0, unchanged: 0, target: MOCK_TARGET };
    },
    async aiThemeify(html: string) {
      const themed = themeifyHtml(html);
      return { html: themed, issues: validateThemeHtml(themed) };
    },
    async aiDraft(prompt: string) {
      return draftText(prompt);
    },
    async aiRewrite(text: string, instruction: string) {
      return rewriteText(text, instruction);
    },
    async aiSeo(title: string, bodyHtml: string) {
      return seoSuggest(title, bodyHtml);
    },
    async loadAccount(): Promise<AccountView> {
      return mockAccount;
    },
    async listProjects(): Promise<ProjectSummary[]> {
      return mockProjects;
    },
    async listSites(projectId: string): Promise<SiteSummary[]> {
      return mockSites[projectId] ?? [];
    },
    async loadSiteStats(siteId: string): Promise<SiteStats> {
      // Only the active (real) site has data; others are empty until published.
      if (siteId !== ACTIVE_SITE_ID) {
        return { visits: 0, inquiries: 0, pages: 0, visitSeries: [], recentInquiries: [] };
      }
      // A plausible two-week visit series (would come from analytics).
      const visitSeries = [48, 52, 40, 61, 73, 58, 66, 71, 64, 80, 77, 69, 85, 92];
      return {
        visits: 1240,
        inquiries: mockInquiries.length,
        pages: outputCount(),
        visitSeries,
        recentInquiries: mockInquiries,
      };
    },
    async listThemes(): Promise<ThemeSummary[]> {
      return mockThemes;
    },
    async listThemeFiles(): Promise<ThemeFileNode[]> {
      const working = themeWorkingCopy();
      const paths = new Set([...Object.keys(THEME_FILES), ...Object.keys(working)]);
      return [...paths].sort().map((path) => {
        const original = path in THEME_FILES;
        return {
          path,
          kind: themeFileKind(path),
          custom: !original,
          edited: original && path in working,
        };
      });
    },
    async readThemeFile(path: string): Promise<string> {
      const working = themeWorkingCopy();
      return working[path] ?? THEME_FILES[path] ?? "";
    },
    async writeThemeFile(path: string, content: string): Promise<void> {
      const working = themeWorkingCopy();
      working[path] = content;
      saveJson(THEME_KEY, working);
    },
    async deleteThemeFile(path: string): Promise<void> {
      // Remove the working-copy entry: deletes a created part, or reverts an
      // edited original (which then falls back to the theme's version).
      const working = themeWorkingCopy();
      delete working[path];
      saveJson(THEME_KEY, working);
    },
    async renameThemeFile(from: string, to: string): Promise<void> {
      const working = themeWorkingCopy();
      // Only created parts (not original theme files) can be renamed.
      if (from in THEME_FILES || to in THEME_FILES || to in working) return;
      working[to] = working[from] ?? "";
      delete working[from];
      saveJson(THEME_KEY, working);
    },
    async resetTheme(): Promise<void> {
      try {
        localStorage.removeItem(THEME_KEY);
      } catch {
        /* ignore storage failures in the mock */
      }
    },
    async deleteContent(type: string, slug: string): Promise<void> {
      const next = loadContent().filter((i) => !(i.type === type && i.slug === slug));
      saveJson(CONTENT_KEY, next);
    },
    async listMedia(): Promise<MediaItem[]> {
      return loadMedia();
    },
    async saveMedia(files: MediaUpload[]): Promise<MediaItem[]> {
      const saved: MediaItem[] = files.map((f) => ({
        id: f.fileName.replace(/\.[^.]+$/, ""),
        fileName: f.fileName,
        path: `media/${f.fileName}`,
        width: f.width,
        height: f.height,
        size: f.bytes.length,
        dataUrl: bytesToWebpDataUrl(f.bytes),
      }));
      const byPath = new Map(loadMedia().map((m) => [m.path, m]));
      for (const m of saved) byPath.set(m.path, m);
      try {
        localStorage.setItem(MEDIA_KEY, JSON.stringify([...byPath.values()]));
      } catch {
        /* ignore storage failures in the mock */
      }
      return saved;
    },
  };
}
