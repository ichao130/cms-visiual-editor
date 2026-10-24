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
  ogpDefault?: {
    image?: string;
    description?: string;
  };
  /** Site verification meta tags, keyed by provider. */
  verificationTags?: Record<string, string>;
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
}

export interface PageSettings {
  /** Template name to use; defaults to the page id, then "page". */
  template?: string;
  /**
   * Operator's section order, as a list of section ids. Sections not listed
   * keep their template order after the listed ones. Absent = template order.
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
