import type {
  ContentItem,
  ContentTypeDef,
  FormDef,
  FormSubmission,
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
  renameSection,
  themeifyHtml,
  validateThemeHtml,
  draftText,
  rewriteText,
  seoSuggest,
  preflight,
  validateContent,
  isBinaryAsset,
  assetContentType,
  bytesToDataUrl,
  THEME_FILE_TOMBSTONE,
  isThemeTombstone,
} from "@pcms/engine";
import type { ThemeBundle } from "@pcms/engine";
import type {
  AccountView,
  DeployConfigView,
  FtpSecurity,
  MediaUpload,
  PcmsApi,
  ProjectData,
  ProjectSummary,
  PublishHistoryEntry,
  PublishIssue,
  PublishPreview,
  PublishReport,
  ServerBrowse,
  ServerListing,
  SiteStats,
  SiteSummary,
  ThemeFileKind,
  ThemeFileNode,
  ThemeSummary,
} from "./types.js";
import type { VisitStats, CloudStatus } from "@pcms/shared";
import {
  createEncryptedBackup,
  openEncryptedBackup,
  KvBackupStore,
  type BackupData,
  type BackupRef,
  type EncryptedBackup,
  type KvAdapter,
} from "@pcms/engine";
import { manifestOf, publishDiff } from "./publishDiff.js";

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
import secHeader from "../../../../themes/sample-cafe/sections/header.html?raw";
import secFooter from "../../../../themes/sample-cafe/sections/footer.html?raw";
import secFeatures from "../../../../themes/sample-cafe/sections/features.html?raw";
import secContent from "../../../../themes/sample-cafe/sections/content.html?raw";
import secCta from "../../../../themes/sample-cafe/sections/cta.html?raw";
import blockFeature from "../../../../themes/sample-cafe/blocks/feature.html?raw";
import blockImage from "../../../../themes/sample-cafe/blocks/image.html?raw";
import blockButton from "../../../../themes/sample-cafe/blocks/button.html?raw";
import blockQuote from "../../../../themes/sample-cafe/blocks/quote.html?raw";
import blockRichtext from "../../../../themes/sample-cafe/blocks/richtext.html?raw";
import blockColumns from "../../../../themes/sample-cafe/blocks/columns.html?raw";
import blockHeading from "../../../../themes/sample-cafe/blocks/heading.html?raw";
import blockCta from "../../../../themes/sample-cafe/blocks/cta.html?raw";
import blockBadge from "../../../../themes/sample-cafe/blocks/badge.html?raw";
import blockSpacer from "../../../../themes/sample-cafe/blocks/spacer.html?raw";

import themeJson from "../../../../themes/sample-cafe/theme.json";
import previewCss from "../../../../themes/sample-cafe/assets/style.css?raw";

const SITE_KEY = "pcms.mock.site";
const DRAFT_KEY = "pcms.mock.draft";
const CONTENT_KEY = "pcms.mock.content";
const MEDIA_KEY = "pcms.mock.media";
const MEDIA_FOLDERS_KEY = "pcms.mock.mediaFolders";
const TYPES_KEY = "pcms.mock.types";
const TAX_KEY = "pcms.mock.taxonomies";
const MENUS_KEY = "pcms.mock.menus";
const FORMS_KEY = "pcms.mock.forms";
const REDIRECTS_KEY = "pcms.mock.redirects";

const defaultForms: FormDef[] = [
  {
    id: "contact",
    name: "お問い合わせ",
    fields: [
      { name: "name", label: "お名前", type: "text", required: true },
      { name: "email", label: "メールアドレス", type: "email", required: true },
      { name: "category", label: "ご用件", type: "select", options: ["予約", "取材", "その他"] },
      { name: "message", label: "内容", type: "textarea", required: true },
    ],
    notifyEmails: ["owner@example.test"],
    autoReply: true,
    completionMessage: "お問い合わせありがとうございました。追ってご連絡します。",
  },
];

const mockSubmissions: FormSubmission[] = [
  { id: "s-1", formId: "contact", values: { name: "田中 花子", email: "tanaka@example.com", category: "予約", message: "テイクアウトは可能ですか？" }, receivedAt: "2026-10-22T10:12:00Z" },
  { id: "s-2", formId: "contact", values: { name: "佐藤 健", email: "sato@example.com", category: "取材", message: "豆の卸売についてご相談したいです。" }, receivedAt: "2026-10-21T15:40:00Z" },
  { id: "s-3", formId: "contact", values: { name: "鈴木 一郎", email: "suzuki@example.com", category: "その他", message: "店内でイベントはできますか？" }, receivedAt: "2026-10-20T09:05:00Z" },
];

function loadForms(): FormDef[] {
  try {
    const raw = localStorage.getItem(FORMS_KEY);
    return raw ? (JSON.parse(raw) as FormDef[]) : defaultForms;
  } catch {
    return defaultForms;
  }
}

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
  { id: "sample-beans", fileName: "sample-beans.svg", path: "media/sample-beans.svg", width: 320, height: 200, alt: "焙煎した珈琲豆", dataUrl: svgDataUrl("サンプル：豆", "#5a3e2b") },
  { id: "sample-cup", fileName: "sample-cup.svg", path: "media/sample-cup.svg", width: 320, height: 200, alt: "淹れたての珈琲カップ", dataUrl: svgDataUrl("サンプル：カップ", "#c98a3b") },
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
  // Site-wide header / footer, composed from the theme's header/footer sections.
  // Edited once in the visual editor and shared across every page.
  regions: {
    header: [{ id: "header-1", type: "header" }],
    footer: [{ id: "footer-1", type: "footer" }],
  },
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
        {
          id: "features-1",
          type: "features",
          fields: { title: "選ばれる理由" },
          blocks: [
            { id: "feat-a", type: "feature", fields: { icon: "☕", title: "自家焙煎", text: "毎朝、店内で焙煎した新鮮な豆を使います。" } },
            { id: "feat-b", type: "feature", fields: { icon: "🥐", title: "手づくり", text: "焼き菓子はすべて手づくり。日替わりで並びます。" } },
            { id: "feat-c", type: "feature", fields: { icon: "📶", title: "Wi-Fi完備", text: "電源・Wi-Fiあり。お仕事や読書にもどうぞ。" } },
          ],
        },
      ],
    },
  },
};

const defaultSite: SiteConfig = {
  name: "サンプルサイト",
  baseUrl: "https://example.test",
  permalink: "/:type/:slug/",
};

function loadSite(): SiteConfig {
  try {
    const raw = localStorage.getItem(SITE_KEY);
    return raw ? (JSON.parse(raw) as SiteConfig) : defaultSite;
  } catch {
    return defaultSite;
  }
}

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

/** Empty folders the operator created (folders with items are derived too). */
function loadMediaFolders(): string[] {
  try {
    const raw = localStorage.getItem(MEDIA_FOLDERS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveMediaList(items: MediaItem[]): void {
  try {
    localStorage.setItem(MEDIA_KEY, JSON.stringify(items));
  } catch {
    /* ignore storage failures in the mock */
  }
}

function saveMediaFolders(folders: string[]): void {
  try {
    localStorage.setItem(MEDIA_FOLDERS_KEY, JSON.stringify([...new Set(folders)].sort()));
  } catch {
    /* ignore storage failures in the mock */
  }
}

/** All folders: ones the operator created plus ones in use by items. */
function allMediaFolders(items: MediaItem[], stored: string[]): string[] {
  const set = new Set(stored);
  for (const m of items) if (m.folder) set.add(m.folder);
  return [...set].sort();
}

function loadRedirects(): Redirect[] {
  try {
    const raw = localStorage.getItem(REDIRECTS_KEY);
    return raw ? (JSON.parse(raw) as Redirect[]) : [];
  } catch {
    return [];
  }
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
 * When the permalink pattern changes, every content URL changes, so record a
 * redirect from each old URL to the new one (CLAUDE.md: redirects.json is
 * auto-added on URL change). Merges with the stored list, newest mapping wins,
 * and chains are collapsed so an old→mid→new sequence points old straight at
 * the final URL.
 */
function recordPermalinkRedirects(oldPermalink: string, newPermalink: string): void {
  if (oldPermalink === newPermalink) return;
  const existing = loadRedirects();
  const byFrom = new Map(existing.map((r) => [r.from, r.to]));
  for (const item of loadContent().filter((i) => i.status !== "draft")) {
    const from = contentUrl(item, oldPermalink);
    const to = contentUrl(item, newPermalink);
    if (from === to) continue;
    // Repoint any redirect that targeted the old URL at the new one.
    for (const [f, t] of byFrom) if (t === from) byFrom.set(f, to);
    byFrom.set(from, to);
  }
  // Drop entries whose source is now also a destination's... keep it simple:
  // remove self-pointing and redirects whose source equals a live URL target.
  const merged: Redirect[] = [...byFrom]
    .filter(([from, to]) => from !== to)
    .map(([from, to]) => ({ from, to }));
  saveJson(REDIRECTS_KEY, merged);
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

/** All site data for a backup — never the deploy/connection config (CLAUDE.md). */
function gatherBackupData(): BackupData {
  return {
    site: loadSite(),
    settings: loadDraft() ?? defaultSettings,
    content: loadContent(),
    contentTypes: loadTypes(),
    taxonomies: loadTaxonomies(),
    menus: loadMenus(),
    redirects: loadRedirects(),
    media: loadMedia(),
  };
}

/** Overwrite every site-data store from a restored backup. */
function applyBackupData(data: BackupData): void {
  saveJson(SITE_KEY, data.site);
  saveJson(DRAFT_KEY, data.settings);
  saveJson(CONTENT_KEY, data.content);
  saveJson(TYPES_KEY, data.contentTypes);
  saveJson(TAX_KEY, data.taxonomies);
  saveJson(MENUS_KEY, data.menus);
  saveJson(REDIRECTS_KEY, data.redirects);
  saveJson(MEDIA_KEY, data.media);
}

/** Backup history store, backed by browser storage in the eval build. */
const backupKv: KvAdapter = {
  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore storage failures in the mock */
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
  async keys() {
    try {
      return Object.keys(localStorage);
    } catch {
      return [];
    }
  },
};
const backupStore = new KvBackupStore(backupKv, "pcms.mock.backup.");

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage failures in the mock */
  }
}

const MOCK_TARGET = "ブラウザのモック（実際の送信は行いません）";
const PUBLISHED_KEY = "pcms.mock.published";
const DEPLOY_KEY = "pcms.mock.deploy";

type StoredDeploy =
  | { type: "local"; dir: string }
  | { type: "sftp"; host: string; port: number; username: string; remoteDir: string; hasPassword: boolean }
  | {
      type: "ftp";
      host: string;
      port: number;
      username: string;
      remoteDir: string;
      security: FtpSecurity;
      hasPassword: boolean;
    }
  | {
      type: "s3";
      bucket: string;
      region: string;
      accessKeyId: string;
      prefix: string;
      endpoint: string;
      hasSecret: boolean;
    };

function loadDeploy(): StoredDeploy {
  try {
    const raw = localStorage.getItem(DEPLOY_KEY);
    if (raw) return JSON.parse(raw) as StoredDeploy;
  } catch {
    /* ignore storage failures in the mock */
  }
  return { type: "local", dir: MOCK_TARGET };
}

/**
 * The eval build has no real SFTP server, so an SFTP publish cannot actually
 * succeed. Return a representative transport error (keyed on the saved config)
 * instead of pretending it worked — this is both honest and what drives the
 * publish-error diagnosis in the UI.
 */
function simulatedRemoteError(c: Extract<StoredDeploy, { type: "sftp" | "ftp" }>): string {
  if (c.host.trim() === "") return "getaddrinfo ENOTFOUND ";
  if (!c.hasPassword) {
    return c.type === "ftp"
      ? "530 Login authentication failed"
      : "Error: All configured authentication methods failed";
  }
  return `connect ETIMEDOUT ${c.host}:${c.port}`;
}

/** Representative S3 error for the eval build (no real AWS calls are made). */
function simulatedS3Error(c: Extract<StoredDeploy, { type: "s3" }>): string {
  if (c.bucket.trim() === "") return "The specified bucket does not exist";
  if (!c.hasSecret || c.accessKeyId.trim() === "") {
    return "The AWS Access Key Id you provided does not exist in our records.";
  }
  return `connect ETIMEDOUT ${c.bucket}.s3.${c.region}.amazonaws.com:443`;
}

/** Destination label for a saved deploy config (matches publishSite's target). */
function targetLabelOf(deploy: StoredDeploy): string {
  if (deploy.type === "local") return MOCK_TARGET;
  if (deploy.type === "s3") {
    const where = deploy.prefix ? `${deploy.bucket}/${deploy.prefix}` : deploy.bucket;
    return `S3: ${where}（${deploy.region}）`;
  }
  const label = deploy.type === "sftp" ? "SFTP" : deploy.security === "ftp" ? "FTP" : "FTPS";
  return `${label}: ${deploy.username}@${deploy.host}:${deploy.remoteDir}`;
}

/**
 * A representative rental-server directory tree for the folder browser in the
 * eval build (no real server). Shaped like a typical shared host: the login
 * lands above the domains, each domain has its own public_html, and one already
 * holds a WordPress install — so browsing to "ここだ！" is demonstrable.
 */
const MOCK_FS: Record<string, { name: string; isDirectory: boolean }[]> = {
  "/": [
    { name: "example.com", isDirectory: true },
    { name: "sub.example.com", isDirectory: true },
    { name: "mail", isDirectory: true },
    { name: "readme.txt", isDirectory: false },
  ],
  "/example.com": [
    { name: "public_html", isDirectory: true },
    { name: "log", isDirectory: true },
  ],
  "/example.com/public_html": [
    { name: "wp", isDirectory: true },
    { name: ".htaccess", isDirectory: false },
    { name: "index.php", isDirectory: false },
  ],
  "/example.com/public_html/wp": [
    { name: "wp-admin", isDirectory: true },
    { name: "wp-content", isDirectory: true },
    { name: "wp-includes", isDirectory: true },
    { name: "index.php", isDirectory: false },
    { name: "wp-config.php", isDirectory: false },
  ],
  "/sub.example.com": [{ name: "public_html", isDirectory: true }],
  "/sub.example.com/public_html": [{ name: "index.html", isDirectory: false }],
  "/mail": [],
};

/** Browse one level of the fake server tree (eval build; no real connection). */
function mockBrowse(path: string): ServerBrowse {
  let dir = (path || "/").trim() || "/";
  if (dir.length > 1 && dir.endsWith("/")) dir = dir.slice(0, -1);
  const entries = (MOCK_FS[dir] ?? []).slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
  const parent = dir === "/" ? null : dir.slice(0, dir.lastIndexOf("/")) || "/";
  return { path: dir, parent, entries };
}

/** Content hash per output path for the current generated site. */
function currentManifest(): Record<string, string> {
  return manifestOf(generateMockSite());
}

function loadPublished(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(PUBLISHED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : null;
  } catch {
    return null;
  }
}

/** Generate the whole site output, as the engine would for a publish. */
function mockSiteInput() {
  return {
    site: loadSite(),
    settings: loadDraft() ?? defaultSettings,
    contentTypes: loadTypes(),
    content: loadContent(),
    theme: buildTheme(),
    menus: loadMenus(),
    taxonomies: loadTaxonomies(),
    media: loadMedia(),
    redirects: loadRedirects(),
  };
}

function generateMockSite(): Record<string, string> {
  const input = mockSiteInput();
  const media = input.media;
  const { files, assets } = generateSite(input);
  // Mirror the desktop's assembleOutput: the published set also carries the
  // theme's copied assets and the media files, so the pre-publish check resolves
  // links to them (otherwise /assets/style.css and media look broken) and counts
  // them in the upload total.
  const out: Record<string, string> = { ...files };
  const themeFiles = mergedThemeFiles();
  for (const rel of assets) out[rel] = themeFiles[rel] ?? "";
  for (const m of media) out[m.path] = "";
  return out;
}

/** Count the pages the engine would generate — a real preview number. */
function outputCount(): number {
  return Object.keys(generateMockSite()).length;
}

/** Run the real pre-publish checks over the generated output plus content. */
function preflightIssues(): PublishIssue[] {
  const input = mockSiteInput();
  return [
    ...validateContent(input.contentTypes, input.content),
    ...preflight(generateMockSite()),
  ];
}

// ---------------------------------------------------------------------------
// App-shell mock data (dashboard / projects / sites / themes)
// ---------------------------------------------------------------------------

const mockAccount: AccountView = {
  name: "サンプル オーナー",
  email: "owner@example.test",
  plan: "スタンダード",
  ai: { used: 23, limit: 100 },
};

const mockProjects: ProjectSummary[] = [
  { id: "proj-cafe", name: "サンプルプロジェクト", siteCount: 2 },
  { id: "proj-clinic", name: "クリニック（準備中）", siteCount: 1 },
];

const mockSites: Record<string, SiteSummary[]> = {
  "proj-cafe": [
    { id: "site-cafe", name: "サンプルサイト", domain: "example.test", published: true, stats: { visits: 1240, inquiries: 8 } },
    { id: "site-cafe-lp", name: "季節のキャンペーンLP", domain: "campaign.example.test", published: false, stats: { visits: 0, inquiries: 0 } },
  ],
  "proj-clinic": [
    { id: "site-clinic", name: "〇〇クリニック", domain: "clinic.example.test", published: false, stats: { visits: 0, inquiries: 0 } },
  ],
};

/**
 * Projects and sites the operator creates in the shell, persisted on top of the
 * seed data above. (The theme editor still loads the one active site; new sites
 * carry their own metadata until per-site storage is wired.)
 */
const CREATED_KEY = "pcms.mock.created";
interface CreatedShell {
  projects: ProjectSummary[];
  sites: Record<string, SiteSummary[]>;
  /** Tombstones for deleted seed entities (created ones are removed outright). */
  deletedProjects?: string[];
  deletedSites?: string[];
  /** Name overrides (seed entities are immutable; created ones use these too). */
  projectNames?: Record<string, string>;
  siteNames?: Record<string, string>;
}

function loadCreated(): CreatedShell {
  try {
    const raw = localStorage.getItem(CREATED_KEY);
    if (raw) return JSON.parse(raw) as CreatedShell;
  } catch {
    /* ignore storage failures in the mock */
  }
  return { projects: [], sites: {} };
}

function sitesFor(projectId: string): SiteSummary[] {
  const created = loadCreated();
  const deleted = new Set(created.deletedSites ?? []);
  const names = created.siteNames ?? {};
  return [...(mockSites[projectId] ?? []), ...(created.sites[projectId] ?? [])]
    .filter((s) => !deleted.has(s.id))
    .map((s) => {
      const name = names[s.id];
      return name ? { ...s, name } : s;
    });
}

function allProjects(): ProjectSummary[] {
  const created = loadCreated();
  const deleted = new Set(created.deletedProjects ?? []);
  const names = created.projectNames ?? {};
  return [...mockProjects, ...created.projects]
    .filter((p) => !deleted.has(p.id))
    .map((p) => ({ ...p, name: names[p.id] ?? p.name, siteCount: sitesFor(p.id).length }));
}

/** The site that the theme editor actually loads/edits (loadProject). */
const ACTIVE_SITE_ID = "site-cafe";

const mockInquiries = [
  { id: "inq-1", name: "田中 花子", email: "tanaka@example.com", message: "テイクアウトは可能ですか？", receivedAt: "2026-10-22T10:12:00Z" },
  { id: "inq-2", name: "佐藤 健", email: "sato@example.com", message: "豆の卸売についてご相談したいです。", receivedAt: "2026-10-21T15:40:00Z" },
  { id: "inq-3", name: "鈴木 一郎", email: "suzuki@example.com", message: "店内でイベントはできますか？", receivedAt: "2026-10-20T09:05:00Z" },
];

// Theme source files, exposed to the code editor. Writes go to a localStorage
// working copy overlaid on these originals — the sample-cafe files are never
// modified (CLAUDE.md: テーマのファイルは改変しない).
const THEME_KEY = "pcms.mock.themeFiles";
const ACTIVE_THEME_KEY = "pcms.mock.activeTheme";
const THEMES_KEY = "pcms.mock.themes";
const SAMPLE_THEME_ID = "sample-cafe";
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
  "sections/header.html": secHeader,
  "sections/footer.html": secFooter,
  "sections/features.html": secFeatures,
  "sections/content.html": secContent,
  "sections/cta.html": secCta,
  "blocks/feature.html": blockFeature,
  "blocks/image.html": blockImage,
  "blocks/button.html": blockButton,
  "blocks/quote.html": blockQuote,
  "blocks/richtext.html": blockRichtext,
  "blocks/columns.html": blockColumns,
  "blocks/heading.html": blockHeading,
  "blocks/cta.html": blockCta,
  "blocks/badge.html": blockBadge,
  "blocks/spacer.html": blockSpacer,
  "assets/style.css": previewCss,
};

/** A theme the operator imported (e.g. a converted WordPress theme). */
interface StoredTheme {
  meta: { id: string; name: string; description?: string; source?: string };
  files: Record<string, string>;
}

/** The active theme id (defaults to the bundled sample). */
function activeThemeId(): string {
  try {
    return localStorage.getItem(ACTIVE_THEME_KEY) || SAMPLE_THEME_ID;
  } catch {
    return SAMPLE_THEME_ID;
  }
}

/** Imported themes, keyed by id. */
function createdThemes(): Record<string, StoredTheme> {
  try {
    const raw = localStorage.getItem(THEMES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredTheme>) : {};
  } catch {
    return {};
  }
}

/** The immutable original files of a theme (sample bundle or an imported one). */
function baseThemeFiles(id: string = activeThemeId()): Record<string, string> {
  if (id === SAMPLE_THEME_ID) return THEME_FILES;
  return createdThemes()[id]?.files ?? THEME_FILES;
}

/** The working-copy storage key for a theme (sample keeps the legacy key). */
function workingKey(id: string = activeThemeId()): string {
  return id === SAMPLE_THEME_ID ? THEME_KEY : `${THEME_KEY}.${id}`;
}

function themeWorkingCopy(): Record<string, string> {
  try {
    const raw = localStorage.getItem(workingKey());
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The section id a part path maps to (its file stem), e.g. sections/promo.html → promo. */
function sectionStem(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
}

function themeFileKind(path: string): ThemeFileKind {
  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".json")) return "json";
  if (isBinaryAsset(path)) return "image";
  return "other";
}

/** Theme originals (active theme) overlaid with the code-editor working copy. */
function mergedThemeFiles(): Record<string, string> {
  const merged: Record<string, string> = { ...baseThemeFiles(), ...themeWorkingCopy() };
  // A tombstoned path is a deleted original — drop it so it never reaches the
  // theme bundle, the preview or the published output.
  for (const [path, content] of Object.entries(merged)) {
    if (isThemeTombstone(content)) delete merged[path];
  }
  return merged;
}

/** All theme-relative paths under `assets/` (originals + working copy). */
function themeAssetPaths(): string[] {
  return Object.keys(mergedThemeFiles())
    .filter((p) => p.startsWith("assets/"))
    .sort();
}

/** Binary theme assets as a path → data-URL map (for preview inlining). */
function themeAssetsMap(): Record<string, string> {
  const files = mergedThemeFiles();
  const out: Record<string, string> = {};
  for (const p of themeAssetPaths()) {
    if (isBinaryAsset(p) && files[p]) out[p] = files[p]!;
  }
  return out;
}

/** Text theme assets (css/js/svg/html) as a path → text map (for preview). */
function themeTextAssetsMap(): Record<string, string> {
  const files = mergedThemeFiles();
  const out: Record<string, string> = {};
  for (const p of themeAssetPaths()) {
    if (!isBinaryAsset(p) && typeof files[p] === "string") out[p] = files[p]!;
  }
  return out;
}

/**
 * Build the theme bundle from the merged files, so parts created or edited in
 * the code editor (sections/*.html, templates, layout, assets) flow into the
 * visual editor's section catalog and the preview.
 */
function buildTheme(): ThemeBundle {
  const files = mergedThemeFiles();
  const sections: Record<string, string> = {};
  const blocks: Record<string, string> = {};
  const templates: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const sec = /^sections\/(.+)\.html$/.exec(path);
    if (sec?.[1]) {
      sections[sec[1]] = content;
      continue;
    }
    const blk = /^blocks\/(.+)\.html$/.exec(path);
    if (blk?.[1]) {
      blocks[blk[1]] = content;
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
    blocks,
    assets: themeAssetPaths(),
  };
}

function themeSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "theme"
  );
}

/**
 * The default page composition for a theme. Switching themes resets
 * settings.pages / regions to this (content is untouched). The sample keeps its
 * rich hardcoded layout; an imported theme renders its own templates directly
 * (no section instances), with the layout supplying header/footer.
 */
function presetSettingsFor(id: string): Pick<SiteSettings, "pages" | "regions"> {
  if (id === SAMPLE_THEME_ID) {
    return { pages: defaultSettings.pages, regions: defaultSettings.regions };
  }
  // An imported theme ships its default page composition (home + each imported
  // 固定ページ) in presets/pages.json; use it so switching brings in those pages.
  const raw = baseThemeFiles(id)["presets/pages.json"];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SiteSettings>;
      if (parsed && parsed.pages) {
        return { pages: parsed.pages, regions: parsed.regions ?? {} };
      }
    } catch {
      // fall through to the minimal default
    }
  }
  return { pages: { index: { template: "index" } }, regions: {} };
}

/** Browser mock of window.pcms used by the dev harness. */
export function createMockApi(): PcmsApi {
  return {
    async loadProject(): Promise<ProjectData> {
      return {
        site: loadSite(),
        settings: loadDraft() ?? defaultSettings,
        theme: buildTheme(),
        content: loadContent(),
        menus: loadMenus(),
        contentTypes: loadTypes(),
        taxonomies: loadTaxonomies(),
        previewCss: mergedThemeFiles()["assets/style.css"] ?? previewCss,
        themeAssets: themeAssetsMap(),
        themeTextAssets: themeTextAssetsMap(),
      };
    },
    async saveSite(site: SiteConfig): Promise<void> {
      const prev = loadSite();
      const oldPermalink = prev.permalink ?? "/:type/:slug/";
      const newPermalink = site.permalink ?? "/:type/:slug/";
      saveJson(SITE_KEY, site);
      // A changed permalink pattern moves every content URL — keep old links
      // working by recording redirects (CLAUDE.md: redirects.json auto-added).
      recordPermalinkRedirects(oldPermalink, newPermalink);
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
      return loadDeploy();
    },
    async setDeployConfig(config): Promise<void> {
      if (config.type === "local") {
        saveJson(DEPLOY_KEY, { type: "local", dir: config.dir } satisfies StoredDeploy);
        return;
      }
      if (config.type === "s3") {
        const prevS3 = loadDeploy();
        const prevHasSecret =
          prevS3.type === "s3" &&
          prevS3.bucket === config.bucket &&
          prevS3.accessKeyId === config.accessKeyId &&
          prevS3.hasSecret;
        const hasSecret =
          config.secretAccessKey != null ? config.secretAccessKey !== "" : prevHasSecret;
        saveJson(DEPLOY_KEY, {
          type: "s3",
          bucket: config.bucket,
          region: config.region,
          accessKeyId: config.accessKeyId,
          prefix: config.prefix ?? "",
          endpoint: config.endpoint ?? "",
          hasSecret,
        } satisfies StoredDeploy);
        return;
      }
      const prev = loadDeploy();
      const prevHasPw =
        (prev.type === "sftp" || prev.type === "ftp") &&
        prev.host === config.host &&
        prev.username === config.username &&
        prev.hasPassword;
      const hasPassword = config.password != null ? config.password !== "" : prevHasPw;
      if (config.type === "ftp") {
        const security = config.security ?? "ftps";
        saveJson(DEPLOY_KEY, {
          type: "ftp",
          host: config.host,
          port: config.port ?? (security === "ftps-implicit" ? 990 : 21),
          username: config.username,
          remoteDir: config.remoteDir,
          security,
          hasPassword,
        } satisfies StoredDeploy);
      } else {
        saveJson(DEPLOY_KEY, {
          type: "sftp",
          host: config.host,
          port: config.port ?? 22,
          username: config.username,
          remoteDir: config.remoteDir,
          hasPassword,
        } satisfies StoredDeploy);
      }
    },
    async previewPublish(full = false): Promise<PublishPreview> {
      const next = currentManifest();
      const diff = publishDiff(loadPublished(), next);
      const uploadPaths = full ? Object.keys(next).sort() : diff.upload;
      const unchanged = full ? 0 : diff.unchanged.length;
      return {
        issues: preflightIssues(),
        upload: uploadPaths.length,
        delete: diff.delete.length,
        unchanged,
        uploadPaths,
        deletePaths: diff.delete,
        target: MOCK_TARGET,
        serverListed: true, // the mock's simulated store is always readable
      };
    },
    async publishSite(full = false): Promise<PublishReport> {
      const issues = preflightIssues();
      const blocked = issues.some((i) => i.level === "error");
      if (blocked) {
        return {
          ok: false,
          blocked: true,
          issues,
          uploaded: 0,
          deleted: 0,
          unchanged: 0,
          target: MOCK_TARGET,
          publishedAt: new Date().toISOString(),
        };
      }
      // No real SFTP server in the eval build: report a representative transport
      // failure so the diagnosis UI can be exercised (local keeps succeeding).
      const deploy = loadDeploy();
      if (deploy.type === "sftp" || deploy.type === "ftp") {
        const label =
          deploy.type === "sftp" ? "SFTP" : deploy.security === "ftp" ? "FTP" : "FTPS";
        return {
          ok: false,
          issues,
          uploaded: 0,
          deleted: 0,
          unchanged: 0,
          target: `${label}: ${deploy.username}@${deploy.host}:${deploy.remoteDir}`,
          error: simulatedRemoteError(deploy),
          rolledBack: true,
          publishedAt: new Date().toISOString(),
        };
      }
      if (deploy.type === "s3") {
        const where = deploy.prefix ? `${deploy.bucket}/${deploy.prefix}` : deploy.bucket;
        return {
          ok: false,
          issues,
          uploaded: 0,
          deleted: 0,
          unchanged: 0,
          target: `S3: ${where}（${deploy.region}）`,
          error: simulatedS3Error(deploy),
          rolledBack: true,
          publishedAt: new Date().toISOString(),
        };
      }
      // Diff against the last publish, then record this publish as the new
      // baseline so the next preview shows only what changed since.
      const next = currentManifest();
      const diff = publishDiff(loadPublished(), next);
      const uploaded = full ? Object.keys(next).length : diff.upload.length;
      saveJson(PUBLISHED_KEY, next);
      return {
        ok: true,
        issues,
        uploaded,
        deleted: diff.delete.length,
        unchanged: full ? 0 : diff.unchanged.length,
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
    async listLocalFiles(): Promise<string[]> {
      return Object.keys(currentManifest()).sort();
    },
    async listServerFiles(): Promise<ServerListing> {
      const deploy = loadDeploy();
      const target = targetLabelOf(deploy);
      // No real server in the eval build: a remote target reports a
      // representative connection failure (as publish does) so the offline /
      // diagnosis path is demonstrable. For the local-folder target, the
      // "server" is the folder this app last published into — reflect its
      // contents (the last publish manifest).
      if (deploy.type === "sftp" || deploy.type === "ftp") {
        return { files: [], target, error: simulatedRemoteError(deploy) };
      }
      if (deploy.type === "s3") {
        return { files: [], target, error: simulatedS3Error(deploy) };
      }
      const published = loadPublished();
      return { files: published ? Object.keys(published).sort() : [], target };
    },
    async browseServer(path: string): Promise<ServerBrowse> {
      const deploy = loadDeploy();
      // Only FTP/SFTP support browsing. In the eval build there is no real
      // server, so a reachable target (host set + password saved) walks a
      // representative fake tree; otherwise the connection-style error path is
      // demonstrated, same as listServerFiles / publish.
      if (deploy.type !== "sftp" && deploy.type !== "ftp") {
        return { path: "", parent: null, entries: [], error: "この公開先はフォルダ参照に対応していません。" };
      }
      if (deploy.host.trim() === "" || !deploy.hasPassword) {
        return { path: "", parent: null, entries: [], error: simulatedRemoteError(deploy) };
      }
      return mockBrowse(path);
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
      return allProjects();
    },
    async createProject(name: string): Promise<ProjectSummary> {
      const created = loadCreated();
      const project: ProjectSummary = { id: `proj-${Date.now()}`, name, siteCount: 0 };
      created.projects.push(project);
      saveJson(CREATED_KEY, created);
      return project;
    },
    async deleteProject(projectId: string): Promise<void> {
      const created = loadCreated();
      const wasCreated = created.projects.some((p) => p.id === projectId);
      created.projects = created.projects.filter((p) => p.id !== projectId);
      if (!wasCreated) {
        created.deletedProjects = [...new Set([...(created.deletedProjects ?? []), projectId])];
      }
      saveJson(CREATED_KEY, created);
    },
    async renameProject(projectId: string, name: string): Promise<void> {
      const created = loadCreated();
      (created.projectNames ??= {})[projectId] = name;
      saveJson(CREATED_KEY, created);
    },
    async listSites(projectId: string): Promise<SiteSummary[]> {
      return sitesFor(projectId);
    },
    async createSite(projectId: string, name: string): Promise<SiteSummary> {
      const created = loadCreated();
      const site: SiteSummary = {
        id: `site-${Date.now()}`,
        name,
        domain: "",
        published: false,
        stats: { visits: 0, inquiries: 0 },
      };
      (created.sites[projectId] ??= []).push(site);
      saveJson(CREATED_KEY, created);
      return site;
    },
    async deleteSite(projectId: string, siteId: string): Promise<void> {
      const created = loadCreated();
      const list = created.sites[projectId] ?? [];
      const wasCreated = list.some((s) => s.id === siteId);
      created.sites[projectId] = list.filter((s) => s.id !== siteId);
      if (!wasCreated) {
        created.deletedSites = [...new Set([...(created.deletedSites ?? []), siteId])];
      }
      saveJson(CREATED_KEY, created);
    },
    async renameSite(_projectId: string, siteId: string, name: string): Promise<void> {
      const created = loadCreated();
      (created.siteNames ??= {})[siteId] = name;
      saveJson(CREATED_KEY, created);
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
    async fetchVisitStats(siteId: string, days = 14): Promise<VisitStats> {
      // No analytics backend in the evaluation build: return deterministic
      // sample data tagged source "mock" so the dashboard can label it. A real
      // build calls the Firebase `visitStats` proxy (GA4 / MOKKEDA).
      const span = Math.min(90, Math.max(1, Math.trunc(days)));
      const today = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      );
      const active = siteId === ACTIVE_SITE_ID;
      const seed = [...siteId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
      const series = Array.from({ length: span }, (_, i) => {
        const date = new Date(today - (span - 1 - i) * 86400000).toISOString().slice(0, 10);
        const h = Math.abs(((seed + i * 2654435761) ^ (seed >> 3)) % 60);
        return { date, visits: active ? 40 + h : 0 };
      });
      return {
        total: series.reduce((a, p) => a + p.visits, 0),
        series,
        source: "mock",
        days: span,
      };
    },
    async fetchRenderedPage(
      url: string,
    ): Promise<{ html: string; css: Record<string, string>; baseUrl: string; notes: string[] }> {
      // The mock has no server-side fetcher, so it uses the browser's own fetch —
      // works for same-origin pages (a localhost dev page), cross-origin is subject
      // to CORS. The real desktop backend fetches server-side with no such limit.
      const base = new URL(url, window.location.href).href;
      const res = await fetch(base);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const css: Record<string, string> = {};
      let fetched = 0;
      let skipped = 0;
      for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
        if (!/\brel\s*=\s*(['"])[^'"]*stylesheet[^'"]*\1/i.test(tag)) continue;
        const m = tag.match(/\bhref\s*=\s*(['"])([^'"]+)\1/i);
        if (!m?.[2]) continue;
        const abs = new URL(m[2], base);
        if (abs.host !== new URL(base).host) {
          skipped += 1;
          continue;
        }
        try {
          const text = await (await fetch(abs.href)).text();
          css[abs.pathname.split("/").filter(Boolean).pop() ?? `style-${fetched}.css`] = text;
          fetched += 1;
        } catch {
          skipped += 1;
        }
      }
      const notes = [`ページを取得し、同一サイトのCSS ${fetched}件を取り込みました。`];
      if (skipped > 0) notes.push(`外部または取得できなかったCSS ${skipped}件はリンクのまま残します。`);
      return { html, css, baseUrl: base, notes };
    },
    async listThemes(): Promise<ThemeSummary[]> {
      const active = activeThemeId();
      const sample: ThemeSummary = {
        id: SAMPLE_THEME_ID,
        name: "Sample Cafe",
        description: "カフェ・小規模店舗向けのサンプルテーマ。",
        current: active === SAMPLE_THEME_ID,
      };
      const imported = Object.values(createdThemes()).map<ThemeSummary>((t) => ({
        id: t.meta.id,
        name: t.meta.name,
        description: t.meta.description ?? "",
        current: t.meta.id === active,
      }));
      return [sample, ...imported];
    },
    async createTheme(meta, files): Promise<ThemeSummary> {
      const existing = createdThemes();
      const base = themeSlug(meta.name);
      let id = base;
      let n = 1;
      while (id === SAMPLE_THEME_ID || existing[id]) id = `${base}-${++n}`;
      existing[id] = {
        meta: { id, name: meta.name, description: meta.description, source: meta.source },
        files,
      };
      saveJson(THEMES_KEY, existing);
      return { id, name: meta.name, description: meta.description ?? "", current: false };
    },
    async setActiveTheme(id: string): Promise<void> {
      // Stored raw (not JSON) — activeThemeId() reads it back with getItem().
      try {
        localStorage.setItem(ACTIVE_THEME_KEY, id);
      } catch {
        /* ignore storage failures in the mock */
      }
      // Reset page composition to the new theme's defaults; content is untouched.
      const preset = presetSettingsFor(id);
      const current = loadDraft() ?? defaultSettings;
      const next: SiteSettings = { ...current, pages: preset.pages, regions: preset.regions };
      delete next.theme; // clear the old theme's colour overrides
      saveJson(DRAFT_KEY, next);
    },
    async renameTheme(id: string, name: string): Promise<void> {
      const trimmed = name.trim();
      if (id === SAMPLE_THEME_ID) throw new Error("cannot rename the bundled sample theme");
      if (!trimmed) throw new Error("theme name must not be empty");
      const themes = createdThemes();
      const theme = themes[id];
      if (!theme) throw new Error(`theme not found: ${id}`);
      theme.meta = { ...theme.meta, name: trimmed };
      saveJson(THEMES_KEY, themes);
    },
    async deleteTheme(id: string): Promise<void> {
      if (id === SAMPLE_THEME_ID) throw new Error("cannot delete the bundled sample theme");
      const themes = createdThemes();
      if (!themes[id]) throw new Error(`theme not found: ${id}`);
      // Switch away before removing, so nothing points at the deleted theme.
      if (activeThemeId() === id) await this.setActiveTheme(SAMPLE_THEME_ID);
      delete themes[id];
      saveJson(THEMES_KEY, themes);
      try {
        localStorage.removeItem(workingKey(id));
      } catch {
        /* ignore storage failures in the mock */
      }
    },
    async listThemeFiles(): Promise<ThemeFileNode[]> {
      const base = baseThemeFiles();
      const working = themeWorkingCopy();
      const paths = new Set([...Object.keys(base), ...Object.keys(working)]);
      return [...paths]
        // Hide deleted originals (tombstones) from the file tree.
        .filter((path) => !isThemeTombstone(working[path]))
        .sort()
        .map((path) => {
          const original = path in base;
          return {
            path,
            kind: themeFileKind(path),
            custom: !original,
            edited: original && path in working,
            binary: isBinaryAsset(path),
          };
        });
    },
    async readThemeFile(path: string): Promise<string> {
      const working = themeWorkingCopy();
      if (isThemeTombstone(working[path])) return "";
      return working[path] ?? baseThemeFiles()[path] ?? "";
    },
    async writeThemeFile(path: string, content: string): Promise<void> {
      const working = themeWorkingCopy();
      working[path] = content;
      saveJson(workingKey(), working);
    },
    async writeThemeAsset(path: string, bytes: Uint8Array): Promise<void> {
      // The working copy is string-only, so a binary asset is kept as a data URL.
      const working = themeWorkingCopy();
      working[path] = bytesToDataUrl(bytes, assetContentType(path));
      saveJson(workingKey(), working);
    },
    async deleteThemeFile(path: string): Promise<void> {
      // Remove the working-copy entry: deletes a created part, or reverts an
      // edited original (which then falls back to the theme's version).
      const working = themeWorkingCopy();
      delete working[path];
      saveJson(workingKey(), working);
    },
    async removeThemeFile(path: string): Promise<void> {
      // Fully remove a file. An original is tombstoned (disk untouched); a
      // created part is just dropped. Recoverable via resetTheme.
      const working = themeWorkingCopy();
      if (path in baseThemeFiles()) working[path] = THEME_FILE_TOMBSTONE;
      else delete working[path];
      saveJson(workingKey(), working);
    },
    async renameThemeFile(from: string, to: string): Promise<void> {
      const base = baseThemeFiles();
      const working = themeWorkingCopy();
      // Only created parts (not original theme files) can be renamed.
      if (from in base || to in base || to in working) return;
      // Keep the contents consistent: update data-section / default data-label.
      working[to] = renameSection(working[from] ?? "", sectionStem(from), sectionStem(to));
      delete working[from];
      saveJson(workingKey(), working);
    },
    async resetTheme(): Promise<void> {
      try {
        localStorage.removeItem(workingKey());
      } catch {
        /* ignore storage failures in the mock */
      }
    },
    async listForms(): Promise<FormDef[]> {
      return loadForms();
    },
    async saveForms(_siteId: string, forms: FormDef[]): Promise<void> {
      saveJson(FORMS_KEY, forms);
    },
    async listSubmissions(_siteId: string, formId: string): Promise<FormSubmission[]> {
      return mockSubmissions.filter((s) => s.formId === formId);
    },
    async cloudFormTarget(): Promise<{ endpoint: string; siteId: string } | null> {
      // The browser eval build has no cloud; the embed shows a placeholder.
      return null;
    },
    async createBackup(passphrase: string): Promise<EncryptedBackup> {
      return createEncryptedBackup(gatherBackupData(), passphrase);
    },
    async restoreBackup(backup: EncryptedBackup, passphrase: string): Promise<void> {
      applyBackupData((await openEncryptedBackup(backup, passphrase)).data);
    },
    async uploadBackup(passphrase: string): Promise<BackupRef> {
      // "Cloud" in the eval build is browser storage; a real build points the
      // same store at Firebase Storage. Only ciphertext is ever stored.
      return backupStore.save(await createEncryptedBackup(gatherBackupData(), passphrase));
    },
    async listBackups(): Promise<BackupRef[]> {
      return backupStore.list();
    },
    async restoreFromBackup(id: string, passphrase: string): Promise<void> {
      const blob = await backupStore.load(id);
      applyBackupData((await openEncryptedBackup(blob, passphrase)).data);
    },
    async deleteBackup(id: string): Promise<void> {
      await backupStore.remove(id);
    },
    async cloudStatus(): Promise<CloudStatus> {
      // The browser eval build has no Firebase config; show as not connected.
      return { configured: false, signedIn: false };
    },
    async signIn(): Promise<CloudStatus> {
      // No real OAuth in the browser eval build; cloud stays unconfigured.
      return { configured: false, signedIn: false };
    },
    async signOut(): Promise<CloudStatus> {
      return { configured: false, signedIn: false };
    },
    async loadRedirects(): Promise<Redirect[]> {
      return loadRedirects();
    },
    async saveRedirects(redirects: Redirect[]): Promise<void> {
      saveJson(REDIRECTS_KEY, redirects);
    },
    async deleteContent(type: string, slug: string): Promise<void> {
      const next = loadContent().filter((i) => !(i.type === type && i.slug === slug));
      saveJson(CONTENT_KEY, next);
    },
    async listMedia(): Promise<MediaItem[]> {
      return loadMedia();
    },
    async saveMedia(files: MediaUpload[], folder?: string): Promise<MediaItem[]> {
      const saved: MediaItem[] = files.map((f) => ({
        id: f.fileName.replace(/\.[^.]+$/, ""),
        fileName: f.fileName,
        path: `media/${f.fileName}`,
        width: f.width,
        height: f.height,
        size: f.bytes.length,
        ...(folder ? { folder } : {}),
        dataUrl: bytesToWebpDataUrl(f.bytes),
      }));
      const byPath = new Map(loadMedia().map((m) => [m.path, m]));
      for (const m of saved) byPath.set(m.path, m);
      saveMediaList([...byPath.values()]);
      return saved;
    },
    async deleteMedia(path: string): Promise<void> {
      saveMediaList(loadMedia().filter((m) => m.path !== path));
    },
    async setMediaAlt(path: string, alt: string): Promise<void> {
      saveMediaList(loadMedia().map((m) => (m.path === path ? { ...m, alt } : m)));
    },
    async setMediaFolder(path: string, folder: string): Promise<void> {
      saveMediaList(
        loadMedia().map((m) =>
          m.path === path ? { ...m, folder: folder || undefined } : m,
        ),
      );
    },
    async listMediaFolders(): Promise<string[]> {
      return allMediaFolders(loadMedia(), loadMediaFolders());
    },
    async createMediaFolder(name: string): Promise<void> {
      const trimmed = name.trim();
      if (trimmed === "") return;
      saveMediaFolders([...loadMediaFolders(), trimmed]);
    },
    async deleteMediaFolder(name: string): Promise<void> {
      saveMediaList(
        loadMedia().map((m) => (m.folder === name ? { ...m, folder: undefined } : m)),
      );
      saveMediaFolders(loadMediaFolders().filter((f) => f !== name));
    },
  };
}
