import type { ContentItem, SiteSettings } from "@pcms/shared";
import type { PcmsApi, ProjectData } from "./types.js";

// Read the sample-cafe theme at build time as raw strings (Vite ?raw). This
// keeps the dev harness free of any filesystem access at runtime.
import layout from "../../../../themes/sample-cafe/layout.html?raw";
import indexTpl from "../../../../themes/sample-cafe/templates/index.html?raw";
import pageTpl from "../../../../themes/sample-cafe/templates/page.html?raw";
import postTpl from "../../../../themes/sample-cafe/templates/post.html?raw";
import themeJson from "../../../../themes/sample-cafe/theme.json";
import previewCss from "../../../../themes/sample-cafe/assets/style.css?raw";

const DRAFT_KEY = "pcms.mock.draft";
const CONTENT_KEY = "pcms.mock.content";

const defaultContent: ContentItem[] = [
  { type: "post", slug: "open", fields: { title: "開店しました", date: "2026-02-01" }, body: "# ごあいさつ\n\n本日**開店**しました。ぜひお立ち寄りください。" },
  { type: "post", slug: "hours", fields: { title: "営業時間のお知らせ", date: "2026-02-10" }, body: "平日は *9時* から営業します。\n\n- 月〜金 9:00-19:00\n- 土日 10:00-18:00" },
  { type: "page", slug: "about", fields: { title: "お店について" }, body: "小さな自家焙煎の珈琲店です。" },
];

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
              { name: "本日のケーキ", price: "420円", note: "日替わりです。" },
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
          templates: { index: indexTpl, page: pageTpl, post: postTpl },
          assets: ["assets/style.css"],
        },
        content: loadContent(),
        menus: {
          menu: [
            { label: "ホーム", url: "/" },
            { label: "お知らせ", url: "/post/open/" },
          ],
        },
        contentTypes: [],
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
      try {
        localStorage.setItem(CONTENT_KEY, JSON.stringify(content));
      } catch {
        /* ignore storage failures in the mock */
      }
    },
  };
}
