import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ContentItem,
  MenuItem,
  SiteConfig,
  SiteSettings,
} from "@pcms/shared";
import type { SiteInput, ThemeBundle } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const themeDir = join(here, "../../../themes/sample-cafe");

function read(rel: string): string {
  return readFileSync(join(themeDir, rel), "utf8");
}

/** Load every `sections/*.html` of the sample theme, keyed by basename. */
function sampleSections(): Record<string, string> {
  const dir = join(themeDir, "sections");
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".html")) out[basename(file, ".html")] = read(`sections/${file}`);
  }
  return out;
}

/** Load the sample-cafe theme from disk into an in-memory bundle. */
export function sampleTheme(): ThemeBundle {
  return {
    config: JSON.parse(read("theme.json")),
    layout: read("layout.html"),
    templates: {
      index: read("templates/index.html"),
      page: read("templates/page.html"),
      post: read("templates/post.html"),
    },
    sections: sampleSections(),
    assets: ["assets/style.css"],
  };
}

export function sampleSite(): SiteConfig {
  return {
    name: "テスト珈琲店",
    baseUrl: "https://example.test",
    permalink: "/:type/:slug/",
    ogpDefault: {
      image: "/media/sample-beans.svg",
      description: "駅前の小さな自家焙煎珈琲店です。",
    },
    verificationTags: { google: "test-google-token" },
  };
}

export function sampleMenus(): Record<string, MenuItem[]> {
  return {
    menu: [
      { label: "ホーム", url: "/" },
      { label: "お知らせ", url: "/news/" },
    ],
  };
}

export function samplePosts(): ContentItem[] {
  return [
    {
      type: "post",
      slug: "open",
      fields: { title: "開店しました", date: "2026-02-01" },
      body: "<h2>ごあいさつ</h2><p>本日<strong>開店</strong>しました。</p>",
    },
    {
      type: "post",
      slug: "hours",
      fields: { title: "営業時間のお知らせ", date: "2026-02-10" },
      body: "<p>平日は <em>9時</em> から営業します。</p>",
    },
    {
      type: "page",
      slug: "about",
      fields: { title: "お店について" },
      body: "<p>小さな自家焙煎の珈琲店です。</p><ul><li>こだわり1</li><li>こだわり2</li></ul>",
    },
  ];
}

export function sampleSettings(): SiteSettings {
  return {
    regions: {
      header: [{ id: "header-1", type: "header" }],
      footer: [{ id: "footer-1", type: "footer" }],
    },
    pages: {
      index: {
        fields: {
          "hero.heading": "朝の一杯を、ていねいに。",
          "hero.lead": "テスト用のリード文です。",
          "hero.cta_label": "ドリンクを見る",
          "hero.cta_url": "/page/about/",
          "news.title": "新着情報",
          "menu.title": "ドリンク",
        },
        sections: [
          {
            id: "menu",
            repeats: {
              items: [
                { name: "ブレンド", price: "480円", note: "やさしい口当たり。" },
                { name: "カフェラテ", price: "550円" },
              ],
            },
          },
        ],
      },
    },
  };
}

export function sampleInput(): SiteInput {
  return {
    site: sampleSite(),
    settings: sampleSettings(),
    contentTypes: [],
    content: samplePosts(),
    theme: sampleTheme(),
    menus: sampleMenus(),
  };
}
