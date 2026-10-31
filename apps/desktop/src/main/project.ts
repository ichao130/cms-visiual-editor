import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { app } from "electron";
import type {
  ContentItem,
  ContentTypeDef,
  FieldValue,
  MediaItem,
  MenuItem,
  Redirect,
  SiteConfig,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import { BUILTIN_CONTENT_TYPES, BUILTIN_TAXONOMIES } from "@pcms/shared";
import {
  generateSite,
  parseFrontMatter,
  renderMarkdown,
  createEncryptedBackup,
  openEncryptedBackup,
  type BackupData,
  type EncryptedBackup,
} from "@pcms/engine";
import type { FileSet } from "@pcms/deploy";
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
  // Packaged: the theme is shipped as an extraResource under resources/.
  if (app.isPackaged) return join(process.resourcesPath, "themes/sample-cafe");
  // Dev: from out/main back up to the repo root, then themes/sample-cafe.
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

function sitePath(): string {
  return join(siteDir(), "site.json");
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

function taxonomiesPath(): string {
  return join(siteDir(), "taxonomies.json");
}

function loadTaxonomies(): TaxonomyDef[] {
  const path = taxonomiesPath();
  if (!existsSync(path)) return BUILTIN_TAXONOMIES;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TaxonomyDef[];
  } catch {
    return BUILTIN_TAXONOMIES;
  }
}

function menusPath(): string {
  return join(siteDir(), "menus.json");
}

const defaultMenus: Record<string, MenuItem[]> = {
  menu: [
    { label: "ホーム", url: "/" },
    { label: "お知らせ", url: "/post/open/" },
  ],
};

function loadMenus(): Record<string, MenuItem[]> {
  const path = menusPath();
  if (!existsSync(path)) return defaultMenus;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, MenuItem[]>;
  } catch {
    return defaultMenus;
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
      instances: [
        {
          id: "hero-1",
          type: "hero",
          fields: {
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
            ],
          },
        },
        { id: "gallery-1", type: "gallery", fields: { title: "店内のようす" } },
      ],
    },
  },
};

const defaultContent: ContentItem[] = [
  { type: "post", slug: "open", fields: { title: "開店しました", date: "2026-02-01" }, body: "<h2>ごあいさつ</h2><p>本日<strong>開店</strong>しました。ぜひお立ち寄りください。</p>" },
  { type: "post", slug: "hours", fields: { title: "営業時間のお知らせ", date: "2026-02-10" }, body: "<p>平日は <em>9時</em> から営業します。</p><ul><li>月〜金 9:00-19:00</li><li>土日 10:00-18:00</li></ul>" },
  { type: "page", slug: "about", fields: { title: "お店について" }, body: "<p>小さな自家焙煎の珈琲店です。</p>" },
];

function readTheme(rel: string): string {
  return readFileSync(join(themeDir(), rel), "utf8");
}

/** Load the theme's reusable sections (sections/<type>.html) for composed pages. */
function readSections(): Record<string, string> {
  const dir = join(themeDir(), "sections");
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".html")) continue;
    out[file.replace(/\.html$/, "")] = readFileSync(join(dir, file), "utf8");
  }
  return out;
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
      // Bodies are HTML (rich text editor). Convert any legacy Markdown body
      // (no HTML tags) once on load so it keeps rendering correctly.
      const html = /<[a-z!/]/i.test(body) ? body : renderMarkdown(body);
      items.push({ type, slug, fields: data, body: html });
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

const defaultSite: SiteConfig = {
  name: "テスト珈琲店",
  baseUrl: "https://example.test",
  permalink: "/:type/:slug/",
};

function loadSite(): SiteConfig {
  const path = sitePath();
  if (!existsSync(path)) return defaultSite;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SiteConfig;
  } catch {
    return defaultSite;
  }
}

export function saveSite(site: SiteConfig): void {
  const oldPermalink = loadSite().permalink ?? "/:type/:slug/";
  writeFileSync(sitePath(), JSON.stringify(site, null, 2), "utf8");
  // A changed permalink pattern moves every content URL — record redirects so
  // old links keep working (CLAUDE.md: redirects.json auto-added on URL change).
  recordPermalinkRedirects(oldPermalink, site.permalink ?? "/:type/:slug/");
}

function redirectsPath(): string {
  return join(siteDir(), "redirects.json");
}

export function loadRedirects(): Redirect[] {
  const path = redirectsPath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Redirect[];
  } catch {
    return [];
  }
}

export function saveRedirects(redirects: Redirect[]): void {
  writeFileSync(redirectsPath(), JSON.stringify(redirects, null, 2), "utf8");
}

/** A content item's URL under a given permalink pattern ("/post/open/"). */
function contentUrl(item: ContentItem, permalink: string): string {
  const rel = (permalink || "/:type/:slug/")
    .replace(/:type/g, item.type)
    .replace(/:slug/g, item.slug)
    .replace(/^\/+|\/+$/g, "");
  return rel === "" ? "/" : `/${rel}/`;
}

/**
 * Record a redirect from each content item's old URL to its new one after the
 * permalink pattern changes, merging with redirects.json. Newest mapping wins
 * and chains are collapsed (old→mid→new becomes old→new).
 */
function recordPermalinkRedirects(oldPermalink: string, newPermalink: string): void {
  if (oldPermalink === newPermalink) return;
  const byFrom = new Map(loadRedirects().map((r) => [r.from, r.to]));
  for (const item of loadContent().filter((i) => i.status !== "draft")) {
    const from = contentUrl(item, oldPermalink);
    const to = contentUrl(item, newPermalink);
    if (from === to) continue;
    for (const [f, t] of byFrom) if (t === from) byFrom.set(f, to);
    byFrom.set(from, to);
  }
  const merged: Redirect[] = [...byFrom]
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({ from, to }));
  writeFileSync(redirectsPath(), JSON.stringify(merged, null, 2), "utf8");
}

export function loadProject(): ProjectData {
  return {
    site: loadSite(),
    settings: loadSettings(),
    theme: {
      config: JSON.parse(readTheme("theme.json")),
      layout: readTheme("layout.html"),
      templates: {
        index: readTheme("templates/index.html"),
        page: readTheme("templates/page.html"),
        post: readTheme("templates/post.html"),
        archive: readTheme("templates/archive.html"),
      },
      sections: readSections(),
      assets: ["assets/style.css"],
    },
    content: loadContent(),
    menus: loadMenus(),
    contentTypes: loadContentTypes(),
    taxonomies: loadTaxonomies(),
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

export function saveMenus(menus: Record<string, MenuItem[]>): void {
  writeFileSync(menusPath(), JSON.stringify(menus, null, 2), "utf8");
}

export function saveTaxonomies(taxonomies: TaxonomyDef[]): void {
  writeFileSync(taxonomiesPath(), JSON.stringify(taxonomies, null, 2), "utf8");
}

/**
 * Assemble the complete publishable output: the generated pages plus the theme
 * assets and site media, as an in-memory file set for the deploy package.
 */
export function assembleOutput(): FileSet {
  const project = loadProject();
  const generated = generateSite({
    site: project.site,
    settings: project.settings,
    contentTypes: project.contentTypes,
    content: project.content,
    theme: project.theme,
    menus: project.menus,
    taxonomies: project.taxonomies,
    media: listMedia(),
    redirects: loadRedirects(),
  });

  const files: FileSet = { ...generated.files };

  for (const rel of generated.assets) {
    try {
      files[rel] = new Uint8Array(readFileSync(join(themeDir(), rel)));
    } catch {
      /* skip assets that cannot be read */
    }
  }

  const mdir = mediaDir();
  for (const file of readdirSync(mdir)) {
    if (file.startsWith(".")) continue;
    files[`media/${file}`] = new Uint8Array(readFileSync(join(mdir, file)));
  }

  return files;
}

export function deleteContent(type: string, slug: string): void {
  const file = join(contentDir(), type, `${slug}.md`);
  if (existsSync(file)) unlinkSync(file);
}

/** Path of the sidecar that stores per-file alt text (fileName → alt). */
function altSidecar(): string {
  return join(mediaDir(), ".alt.json");
}

function readAltMap(): Record<string, string> {
  const file = altSidecar();
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function listMedia(): MediaItem[] {
  const dir = mediaDir();
  const alts = readAltMap();
  const items: MediaItem[] = [];
  for (const file of readdirSync(dir)) {
    if (file.startsWith(".")) continue;
    const item = mediaItemFromBytes(file, readFileSync(join(dir, file)));
    const alt = alts[file];
    items.push(alt != null && alt !== "" ? { ...item, alt } : item);
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

export function deleteMedia(path: string): void {
  // Only ever touch a file inside the media dir (strip any directory part).
  const name = basename(path);
  const file = join(mediaDir(), name);
  if (existsSync(file)) unlinkSync(file);
  const alts = readAltMap();
  if (name in alts) {
    delete alts[name];
    writeFileSync(altSidecar(), JSON.stringify(alts, null, 2));
  }
}

export function setMediaAlt(path: string, alt: string): void {
  const name = basename(path);
  const alts = readAltMap();
  if (alt === "") delete alts[name];
  else alts[name] = alt;
  writeFileSync(altSidecar(), JSON.stringify(alts, null, 2));
}

/** Decode a data: URL to bytes (base64 or URL-encoded), or null if malformed. */
function dataUrlToBytes(url: string): Uint8Array | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  return /;base64$/i.test(meta)
    ? new Uint8Array(Buffer.from(payload, "base64"))
    : new Uint8Array(Buffer.from(decodeURIComponent(payload), "utf8"));
}

/** Write media files (from their data URLs) and alt sidecar from a backup. */
function restoreMedia(items: MediaItem[]): void {
  const dir = mediaDir();
  const alts: Record<string, string> = {};
  for (const m of items) {
    const name = basename(m.path);
    if (m.dataUrl) {
      const bytes = dataUrlToBytes(m.dataUrl);
      if (bytes) writeFileSync(join(dir, name), bytes);
    }
    if (m.alt) alts[name] = m.alt;
  }
  writeFileSync(altSidecar(), JSON.stringify(alts, null, 2));
}

/**
 * Encrypted backup of all site data (never the deploy/connection config —
 * CLAUDE.md). The passphrase encrypts on this machine before the blob is
 * returned to the renderer to be written out.
 */
export async function createBackup(passphrase: string): Promise<EncryptedBackup> {
  const p = loadProject();
  const data: BackupData = {
    site: p.site,
    settings: p.settings,
    content: p.content,
    contentTypes: p.contentTypes,
    taxonomies: p.taxonomies,
    menus: p.menus,
    redirects: loadRedirects(),
    media: listMedia(),
  };
  return createEncryptedBackup(data, passphrase);
}

/** Decrypt a backup and overwrite the site data with its contents. */
export async function restoreBackup(
  backup: EncryptedBackup,
  passphrase: string,
): Promise<void> {
  const { data } = await openEncryptedBackup(backup, passphrase);
  saveSite(data.site);
  saveDraft(data.settings);
  saveContent(data.content);
  saveContentTypes(data.contentTypes);
  saveTaxonomies(data.taxonomies);
  saveMenus(data.menus);
  saveRedirects(data.redirects);
  restoreMedia(data.media);
}
