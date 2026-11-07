/**
 * @pcms/shared — core type definitions shared across engine, editor-ui, deploy.
 *
 * These types are the contract for the site data format described in CLAUDE.md
 * (site.json / settings.json / content-types.json / content/*.md). They are
 * intentionally plain data so a user can always take their site elsewhere.
 */

// ---------------------------------------------------------------------------
// Field types
// ---------------------------------------------------------------------------

/** Field types that the theme/editor can render inline. */
export type InlineFieldType =
  | "text"
  | "richtext"
  | "image"
  | "link"
  | "color"
  | "number"
  | "select";

/** All field types a custom field can declare in content-types.json. */
export type FieldType =
  | InlineFieldType
  | "longtext"
  | "date"
  | "datetime"
  | "gallery"
  | "file"
  | "multiselect"
  | "checkbox"
  | "group"
  | "relation";

// ---------------------------------------------------------------------------
// site.json
// ---------------------------------------------------------------------------

export interface SiteConfig {
  /** Display name of the site. */
  name: string;
  /** Absolute base URL used for sitemap/RSS/canonical, e.g. "https://example.com". */
  baseUrl?: string;
  logo?: string;
  /** Permalink pattern for content items, e.g. "/:type/:slug/". Default per type. */
  permalink?: string;
  /**
   * Content language (BCP 47), e.g. "ja" or "en". Applied to the output's
   * `<html lang>`, the RSS `<language>`, and `og:locale`. Default "ja".
   */
  lang?: string;
  /** Items per page on archive / taxonomy listings. Default 10. */
  archivePageSize?: number;
  ogpDefault?: {
    image?: string;
    description?: string;
  };
  /** Site verification meta tags, keyed by provider. */
  verificationTags?: Record<string, string>;
  /** Access-analytics tags injected into every published page's <head>. */
  analytics?: AnalyticsConfig;
}

/**
 * Access-analytics configuration. Only public tracking tags live here (a GA4
 * Measurement ID is public), never API secrets — reporting-API credentials
 * belong in the Firebase proxy, not in site.json.
 */
export interface AnalyticsConfig {
  /** Google Analytics 4 Measurement ID, e.g. "G-XXXXXXXXXX". */
  ga4?: string;
  /**
   * Any other analytics / heatmap service's tag (e.g. MOKKEDA), inserted
   * verbatim into the published <head>. Operator-provided; output only.
   */
  headSnippet?: string;
}

/** One day's visit count, for the visit-stats series. */
export interface VisitPoint {
  /** W3C date, e.g. "2026-02-01". */
  date: string;
  visits: number;
}

/**
 * Visit numbers read back from the site's analytics provider (GA4 Data API or
 * MOKKEDA) through the Firebase proxy. `source` names the provider ("ga4",
 * "mokkeda") or "mock" when none is configured, so the UI can label sample data.
 */
export interface VisitStats {
  /** Total visits over the window. */
  total: number;
  /** Per-day visits, oldest first. */
  series: VisitPoint[];
  /** Provider the numbers came from: "ga4" | "mokkeda" | "mock". */
  source: string;
  /** Number of days the window covers. */
  days: number;
}

/**
 * A stored redirect (redirects.json). Auto-added when a content URL changes
 * (e.g. the permalink pattern is edited), so old links keep working. Both are
 * site-relative URL paths with a leading slash, e.g. "/post/old/" → "/old/".
 */
export interface Redirect {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Theme settings (colors / fonts / spacing presets)
// ---------------------------------------------------------------------------

export interface ThemeConfig {
  name?: string;
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
  spacing?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// settings.json — per-page section layout + field values + theme settings
// ---------------------------------------------------------------------------

export interface SiteSettings {
  /** Operator overrides of the theme presets. */
  theme?: ThemeConfig;
  /** Page settings keyed by page id (e.g. "index", "about"). */
  pages: Record<string, PageSettings>;
  /**
   * Site-wide header / footer, each an ordered list of section instances —
   * the same composed model as a page body, shared across every page
   * (Shopify-style header/footer groups). Rendered into the layout's
   * `data-slot="header"` / `data-slot="footer"`. When absent (older data) or a
   * region is empty, the layout's own header/footer markup is used as-is, so
   * this is backward compatible.
   */
  regions?: SiteRegions;
}

/** The site-wide section regions (header / footer). */
export interface SiteRegions {
  header?: SectionInstance[];
  footer?: SectionInstance[];
}

/** A site-wide region name. */
export type RegionName = "header" | "footer";

export interface PageSettings {
  /** Template name to use; defaults to the page id, then "page". */
  template?: string;
  /** SEO `<title>` override. Falls back to the site name for the home page. */
  title?: string;
  /** `<meta name="description">` override; otherwise derived from page text. */
  description?: string;
  /**
   * Composed-page layout: an ordered list of section instances. When present,
   * the page is built by composing these from the theme's `sections/`, instead
   * of a fixed template (Shopify-style). The operator can add / reorder /
   * remove instances.
   */
  instances?: SectionInstance[];
  /**
   * Operator's section order, as a list of section ids (fixed-template pages).
   * Sections not listed keep their template order after the listed ones.
   */
  sectionOrder?: string[];
  /** Section visibility / repeat overrides, keyed by section id. */
  sections?: SectionState[];
  /**
   * Field values set by the operator, keyed by the `data-field` path.
   * Absent values fall back to the theme's own default content.
   */
  fields?: Record<string, FieldValue>;
}

export interface SectionState {
  id: string;
  hidden?: boolean;
  /** Operator-managed repeat items, keyed by the `data-repeat` name. */
  repeats?: Record<string, Array<Record<string, FieldValue>>>;
}

/** Per-section visual overrides applied to the section wrapper. */
export interface SectionStyle {
  /** Background color (any CSS color); empty = theme default. */
  background?: string;
  /** Text color. */
  textColor?: string;
  /** Vertical padding preset. */
  paddingY?: "none" | "sm" | "md" | "lg";
  /** Hide the section on one device class in the published output. */
  hideOn?: "mobile" | "desktop";
}

/** One section placed on a composed page. */
export interface SectionInstance {
  /** Unique instance id (stable across edits). */
  id: string;
  /** Section type — the file name in the theme's `sections/`. */
  type: string;
  hidden?: boolean;
  /** Field values, keyed by the section's `data-field` paths. */
  fields?: Record<string, FieldValue>;
  /** Operator-managed repeat rows, keyed by the `data-repeat` name. */
  repeats?: Record<string, Array<Record<string, FieldValue>>>;
  /** Visual overrides (background, text color, spacing). */
  style?: SectionStyle;
  /**
   * Nested blocks (Shopify-style): an ordered list of block instances placed
   * into the section's `data-blocks` container. When absent (older data, or a
   * section whose template has no `data-blocks`) the section renders without
   * blocks, so this is backward compatible. Block types come from the theme's
   * `blocks/<type>.html`.
   */
  blocks?: BlockInstance[];
}

/**
 * One block placed inside a section instance's `data-blocks` container. Blocks
 * reuse the same field model as sections but are intentionally lighter — no
 * nested blocks, repeats or style in this version (can be added later).
 */
export interface BlockInstance {
  /** Unique block id (stable across edits), unique within the whole site. */
  id: string;
  /** Block type — the file name in the theme's `blocks/`. */
  type: string;
  /** Field values, keyed by the block template's `data-field` paths. */
  fields?: Record<string, FieldValue>;
}

export type FieldValue = string | number | boolean | null | FieldValue[];

// ---------------------------------------------------------------------------
// content-types.json — custom post types & custom fields
// ---------------------------------------------------------------------------

export interface ContentTypeDef {
  /** Machine name / slug, e.g. "post", "staff". */
  name: string;
  /** Label shown in the editor UI (Japanese). */
  label: string;
  /** Whether items of this type produce their own pages. */
  hasArchive?: boolean;
  fields: FieldDef[];
  taxonomies?: string[];
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: FieldValue;
  description?: string;
  /** Display condition — shown when another field has a value. */
  showIf?: { field: string; equals?: FieldValue };
  /** Options for select / multiselect. */
  options?: string[];
  /** Nested fields for `group` type. */
  fields?: FieldDef[];
}

// ---------------------------------------------------------------------------
// Taxonomies (categories / tags / custom classifications)
// ---------------------------------------------------------------------------

export interface TaxonomyDef {
  /** Machine name, used as the field key on content items (e.g. "category"). */
  name: string;
  label: string;
  /** Content type names this taxonomy applies to. */
  types: string[];
  /** Predefined terms. Absent / empty means free-form (tag-like). */
  terms?: string[];
  /** Whether an item may have several terms. */
  multiple?: boolean;
}

export const BUILTIN_TAXONOMIES: TaxonomyDef[] = [
  {
    name: "category",
    label: "カテゴリ",
    types: ["post"],
    terms: ["お知らせ", "イベント", "メニュー"],
    multiple: false,
  },
  { name: "tag", label: "タグ", types: ["post"], multiple: true },
];

/**
 * The content types every site starts with. They are ordinary type definitions
 * (not special-cased in the engine), so the operator can add custom fields to
 * them or define entirely new types via the editor.
 */
export const BUILTIN_CONTENT_TYPES: ContentTypeDef[] = [
  {
    name: "post",
    label: "投稿",
    hasArchive: true,
    fields: [
      { name: "title", label: "タイトル", type: "text", required: true },
      { name: "date", label: "日付", type: "date" },
      { name: "body", label: "本文", type: "richtext" },
    ],
  },
  {
    name: "page",
    label: "固定ページ",
    fields: [
      { name: "title", label: "タイトル", type: "text", required: true },
      { name: "body", label: "本文", type: "richtext" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Content items (content/<type>/<slug>.md)
// ---------------------------------------------------------------------------

export interface ContentItem {
  type: string;
  slug: string;
  /** Front-matter fields (title, date, custom fields, ...). */
  fields: Record<string, FieldValue>;
  /** Raw markdown body. */
  body: string;
  /** Body rendered to HTML (filled by the engine). */
  bodyHtml?: string;
  /**
   * Parent item's slug, for hierarchical pages (固定ページの階層). Absent = top
   * level. Added in schema v2; items without it stay top-level (backward
   * compatible), so no migration of existing content/*.md is required.
   */
  parent?: string;
  /**
   * Publication status. Absent or "published" = live; "draft" is kept in the
   * editor but excluded from the generated site. Added in schema v3; items
   * without it stay published (backward compatible), so no migration is needed.
   */
  status?: "draft" | "published";
  /**
   * When true, the item's page is published but asks search engines not to
   * index it: the engine emits `<meta name="robots" content="noindex, follow">`
   * and omits the page from sitemap.xml and the feed. Added in schema v4; items
   * without it are indexed as before (backward compatible), no migration needed.
   */
  noindex?: boolean;
  /**
   * Manual sort index within the item's type (ascending). When the operator
   * reorders a type, every item of that type gets an `order`; loops and archives
   * then follow it instead of the date. Absent on every item of a type = sort by
   * date as before. Added in schema v5 (backward compatible), no migration.
   */
  order?: number;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export interface MediaItem {
  /** Stable id (the file's stem). */
  id: string;
  /** File name within the media directory, e.g. "photo.webp". */
  fileName: string;
  /** Site-relative path used in output HTML, e.g. "media/photo.webp". */
  path: string;
  width?: number;
  height?: number;
  /** Byte size of the stored file. */
  size?: number;
  /**
   * Default alternative text for the image. Emitted as the `alt` attribute when
   * an image field points at this file and the theme's `<img>` has no alt of its
   * own. Optional (v6); older media records simply have none.
   */
  alt?: string;
  /**
   * Organizational folder, for the media manager only (e.g. "banners"). Purely
   * a grouping: the stored file name and output `path` stay flat, so moving an
   * item between folders never changes its URL or breaks references. Empty /
   * undefined means the unfiled root. Added in schema v8 (backward compatible),
   * no migration needed. Nesting (slash-separated) is reserved for later.
   */
  folder?: string;
  /**
   * Data URL for display inside the editor only (thumbnails, preview). Never
   * written to the site — the published HTML references `path`.
   */
  dataUrl?: string;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  url: string;
  children?: MenuItem[];
}

// ---------------------------------------------------------------------------
// Theme schema (produced by the engine parser, consumed by the editor)
// ---------------------------------------------------------------------------

export interface ThemeTemplateSchema {
  /** Template name, e.g. "index". */
  name: string;
  sections: SectionSchema[];
}

export interface SectionSchema {
  id: string;
  label?: string;
  fields: FieldSchema[];
  loops: LoopSchema[];
  repeats: RepeatSchema[];
}

export interface FieldSchema {
  path: string;
  type: InlineFieldType;
  label?: string;
}

export interface LoopSchema {
  /** Collection name, e.g. "posts" or "menu". */
  source: string;
  limit?: number;
}

export interface RepeatSchema {
  name: string;
  fields: FieldSchema[];
}

// ---------------------------------------------------------------------------
// Contact forms (GUI form builder + received submissions)
// ---------------------------------------------------------------------------

export type FormFieldType = "text" | "email" | "textarea" | "tel" | "select" | "checkbox";

export interface FormField {
  /** Stable field key used in submissions and emails. */
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  /** Choices for the "select" type. */
  options?: string[];
}

export interface FormDef {
  id: string;
  name: string;
  fields: FormField[];
  /** Notification recipients (複数宛先). */
  notifyEmails: string[];
  /** Send an auto-reply to the submitter. */
  autoReply: boolean;
  /** Message shown on the completion page. */
  completionMessage: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  values: Record<string, string>;
  /** ISO timestamp of receipt. */
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Cloud (Firebase) connection
// ---------------------------------------------------------------------------

/**
 * The Firebase *web* app config. These values are public by design (they ship
 * in any Firebase web client) — they are NOT secrets and NOT server connection
 * info, so they may live on the PC in firebase.config.json. Secrets (API keys
 * for GA4 / SendGrid / the AI provider) stay in the Functions environment, never
 * in the app (CLAUDE.md: APIキーをアプリに埋め込まない / 接続情報はクラウドに送らない).
 */
export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  /** OAuth 2.0 "Desktop app" client ID, used for the desktop Google sign-in flow. */
  googleClientId?: string;
  /**
   * OAuth 2.0 "Desktop app" client secret. For installed/desktop clients this is
   * not confidential (Google: it can be embedded in the app), but we still keep
   * it PC-only (gitignored config, never uploaded). Google's token endpoint
   * requires it for the authorization-code exchange even with PKCE.
   */
  googleClientSecret?: string;
}

/** Whether cloud is configured on this PC, and the current sign-in state. */
export interface CloudStatus {
  /** firebase.config.json is present and valid. */
  configured: boolean;
  projectId?: string;
  /** The operator is signed in (Firebase Auth). */
  signedIn: boolean;
  email?: string;
}

const REQUIRED_FIREBASE_KEYS = ["apiKey", "authDomain", "projectId", "appId"] as const;

/**
 * Validate an untrusted object as a FirebaseClientConfig. Returns the config on
 * success, or null if a required field is missing / not a string — so a broken
 * config file degrades to "not configured" rather than crashing the app.
 */
export function parseFirebaseConfig(raw: unknown): FirebaseClientConfig | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const key of REQUIRED_FIREBASE_KEYS) {
    if (typeof o[key] !== "string" || (o[key] as string).trim() === "") return null;
  }
  const str = (k: string): string | undefined =>
    typeof o[k] === "string" && (o[k] as string).trim() !== "" ? (o[k] as string) : undefined;
  const config: FirebaseClientConfig = {
    apiKey: o.apiKey as string,
    authDomain: o.authDomain as string,
    projectId: o.projectId as string,
    appId: o.appId as string,
  };
  const bucket = str("storageBucket");
  const sender = str("messagingSenderId");
  const measurement = str("measurementId");
  const clientId = str("googleClientId");
  const clientSecret = str("googleClientSecret");
  if (bucket) config.storageBucket = bucket;
  if (sender) config.messagingSenderId = sender;
  if (measurement) config.measurementId = measurement;
  if (clientId) config.googleClientId = clientId;
  if (clientSecret) config.googleClientSecret = clientSecret;
  return config;
}
