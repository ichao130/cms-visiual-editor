import type {
  ContentItem,
  ContentTypeDef,
  MediaItem,
  MenuItem,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import { BUILTIN_CONTENT_TYPES, BUILTIN_TAXONOMIES } from "@pcms/shared";
import { generateSite } from "@pcms/engine";
import type {
  DeployConfigView,
  MediaUpload,
  PcmsApi,
  ProjectData,
  PublishHistoryEntry,
  PublishPreview,
  PublishReport,
} from "./types.js";

// Read the sample-cafe theme at build time as raw strings (Vite ?raw). This
// keeps the dev harness free of any filesystem access at runtime.
import layout from "../../../../themes/sample-cafe/layout.html?raw";
import indexTpl from "../../../../themes/sample-cafe/templates/index.html?raw";
import pageTpl from "../../../../themes/sample-cafe/templates/page.html?raw";
import postTpl from "../../../../themes/sample-cafe/templates/post.html?raw";
import archiveTpl from "../../../../themes/sample-cafe/templates/archive.html?raw";
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
      fields: {
        "hero.image": "media/sample-beans.svg",
        "hero.heading": "朝の一杯を、ていねいに。",
        "hero.lead": "駅前の小さな自家焙煎珈琲店です。",
        "hero.cta_label": "メニューを見る",
        "hero.cta_url": "/page/about/",
        "news.title": "お知らせ",
        "menu.title": "ドリンク",
        "gallery.title": "店内のようす",
      },
      sections: [
        {
          id: "menu",
          repeats: {
            items: [
              { name: "ブレンドコーヒー", price: "480円", note: "やさしい口当たり。" },
              { name: "カフェラテ", price: "550円", note: "" },
              { name: "本日のケーキ", price: "420円", note: "日替わりです。" },
            ],
          },
        },
        {
          id: "gallery",
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
    theme: {
      config: themeJson,
      layout,
      templates: { index: indexTpl, page: pageTpl, post: postTpl, archive: archiveTpl },
      assets: ["assets/style.css"],
    },
    menus: loadMenus(),
    taxonomies: loadTaxonomies(),
  });
  return Object.keys(generated.files).length;
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
        theme: {
          config: themeJson,
          layout,
          templates: { index: indexTpl, page: pageTpl, post: postTpl, archive: archiveTpl },
          assets: ["assets/style.css"],
        },
        content: loadContent(),
        menus: loadMenus(),
        contentTypes: loadTypes(),
        taxonomies: loadTaxonomies(),
        previewCss,
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
