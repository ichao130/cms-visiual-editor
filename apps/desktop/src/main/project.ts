import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { app } from "electron";
import type {
  ContentItem,
  ContentTypeDef,
  FieldValue,
  MediaItem,
  SiteSettings,
} from "@pcms/shared";
import { BUILTIN_CONTENT_TYPES } from "@pcms/shared";
import { parseFrontMatter } from "@pcms/engine";
import type { MediaUpload, ProjectData } from "@pcms/editor-ui";

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

function contentDir(): string {
  return join(siteDir(), "content");
}

function contentTypesPath(): string {
  return join(siteDir(), "content-types.json");
}

function loadContentTypes(): ContentTypeDef[] {
  const path = contentTypesPath();
  if (!existsSync(path)) return BUILTIN_CONTENT_TYPES;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ContentTypeDef[];
  } catch {
    return BUILTIN_CONTENT_TYPES;
  }
}

function mediaDir(): string {
  const dir = join(siteDir(), "media");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const MIME_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

function mediaItemFromBytes(fileName: string, bytes: Uint8Array): MediaItem {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const base64 = Buffer.from(bytes).toString("base64");
  return {
    id: fileName.replace(/\.[^.]+$/, ""),
    fileName,
    path: `media/${fileName}`,
    size: bytes.length,
    dataUrl: `data:${mime};base64,${base64}`,
  };
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

const defaultContent: ContentItem[] = [
  { type: "post", slug: "open", fields: { title: "開店しました", date: "2026-02-01" }, body: "# ごあいさつ\n\n本日**開店**しました。ぜひお立ち寄りください。" },
  { type: "post", slug: "hours", fields: { title: "営業時間のお知らせ", date: "2026-02-10" }, body: "平日は *9時* から営業します。\n\n- 月〜金 9:00-19:00\n- 土日 10:00-18:00" },
  { type: "page", slug: "about", fields: { title: "お店について" }, body: "小さな自家焙煎の珈琲店です。" },
];

function readTheme(rel: string): string {
  return readFileSync(join(themeDir(), rel), "utf8");
}

/** Serialize a content item to a Markdown file with YAML front matter. */
function serializeItem(item: ContentItem): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(item.fields)) {
    if (key === "url") continue; // derived, never persisted
    lines.push(`${key}: ${serializeScalar(value)}`);
  }
  lines.push("---", "", item.body.trimEnd(), "");
  return lines.join("\n");
}

function serializeScalar(value: FieldValue): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(serializeScalar).join(", ")}]`;
  const s = String(value);
  // Quote when the value could be misread as something other than a string.
  return /^[\s0-9[-]|[:#]/.test(s) ? JSON.stringify(s) : s;
}

function loadContent(): ContentItem[] {
  const dir = contentDir();
  if (!existsSync(dir)) return defaultContent;
  const items: ContentItem[] = [];
  for (const type of readdirSync(dir)) {
    const typeDir = join(dir, type);
    for (const file of readdirSync(typeDir)) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      const { data, body } = parseFrontMatter(readFileSync(join(typeDir, file), "utf8"));
      items.push({ type, slug, fields: data, body });
    }
  }
  return items.length > 0 ? items : defaultContent;
}

function saveContent(content: ContentItem[]): void {
  for (const item of content) {
    const typeDir = join(contentDir(), item.type);
    if (!existsSync(typeDir)) mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, `${item.slug}.md`), serializeItem(item), "utf8");
  }
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
    content: loadContent(),
    menus: {
      menu: [
        { label: "ホーム", url: "/" },
        { label: "お知らせ", url: "/post/open/" },
      ],
    },
    contentTypes: loadContentTypes(),
    previewCss: readTheme("assets/style.css"),
  };
}

export function saveDraft(settings: SiteSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

export { saveContent };

export function saveContentTypes(types: ContentTypeDef[]): void {
  writeFileSync(contentTypesPath(), JSON.stringify(types, null, 2), "utf8");
}

export function deleteContent(type: string, slug: string): void {
  const file = join(contentDir(), type, `${slug}.md`);
  if (existsSync(file)) unlinkSync(file);
}

export function listMedia(): MediaItem[] {
  const dir = mediaDir();
  const items: MediaItem[] = [];
  for (const file of readdirSync(dir)) {
    if (file.startsWith(".")) continue;
    items.push(mediaItemFromBytes(file, readFileSync(join(dir, file))));
  }
  return items;
}

export function saveMedia(files: MediaUpload[]): MediaItem[] {
  const dir = mediaDir();
  return files.map((f) => {
    const bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
    writeFileSync(join(dir, f.fileName), bytes);
    const item = mediaItemFromBytes(f.fileName, bytes);
    return { ...item, width: f.width, height: f.height };
  });
}
