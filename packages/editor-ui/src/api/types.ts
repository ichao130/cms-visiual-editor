import type {
  ContentItem,
  ContentTypeDef,
  MediaItem,
  MenuItem,
  SiteConfig,
  SiteSettings,
  TaxonomyDef,
} from "@pcms/shared";
import type { AiIssue, ThemeBundle } from "@pcms/engine";

/**
 * The project data the editor works on. The theme and content are read-only
 * inputs; the operator's edits live in `settings` (CLAUDE.md: テーマのファイルは
 * 絶対に書き換えない).
 */
export interface ProjectData {
  site: SiteConfig;
  settings: SiteSettings;
  theme: ThemeBundle;
  content: ContentItem[];
  menus: Record<string, MenuItem[]>;
  contentTypes: ContentTypeDef[];
  taxonomies: TaxonomyDef[];
  /** Theme CSS concatenated for the sandboxed live preview. */
  previewCss: string;
}

/**
 * The entire surface the renderer may call. Implemented by the Electron
 * preload (`window.pcms`) over IPC, and by a mock for the browser dev harness.
 * The editor UI must use only this — never Electron APIs directly.
 */
export interface PcmsApi {
  loadProject(): Promise<ProjectData>;
  /** Persist the operator's page edits (settings.json). */
  saveDraft(settings: SiteSettings): Promise<void>;
  /** Persist content items (content/<type>/<slug>.md). */
  saveContent(content: ContentItem[]): Promise<void>;
  /** List media already stored for the site (with data URLs for display). */
  listMedia(): Promise<MediaItem[]>;
  /** Persist imported, already-processed (WebP) images; returns their records. */
  saveMedia(files: MediaUpload[]): Promise<MediaItem[]>;
  /** Persist custom post type / field definitions (content-types.json). */
  saveContentTypes(types: ContentTypeDef[]): Promise<void>;
  /** Persist navigation menus (menus.json). */
  saveMenus(menus: Record<string, MenuItem[]>): Promise<void>;
  /** Persist taxonomy definitions (taxonomies.json). */
  saveTaxonomies(taxonomies: TaxonomyDef[]): Promise<void>;
  /** Delete one content item (removes content/<type>/<slug>.md). */
  deleteContent(type: string, slug: string): Promise<void>;

  // Publishing
  getDeployConfig(): Promise<DeployConfigView>;
  setDeployConfig(config: DeployConfigInput): Promise<void>;
  /** Dry run: pre-publish checks and the change counts, nothing sent. */
  previewPublish(): Promise<PublishPreview>;
  /** Publish the site (diff upload + delete, with rollback on failure). */
  publishSite(): Promise<PublishReport>;
  listPublishHistory(): Promise<PublishHistoryEntry[]>;
  /** Re-publish a previous snapshot. */
  rollbackPublish(id: string): Promise<PublishReport>;

  // AI assist. These go through the Firebase proxy in production (no API key in
  // the app); offline heuristics stand in for the evaluation build.
  aiThemeify(html: string): Promise<AiThemeifyResult>;
  aiDraft(prompt: string): Promise<string>;
  aiRewrite(text: string, instruction: string): Promise<string>;
  aiSeo(title: string, bodyHtml: string): Promise<AiSeoResult>;

  // App shell (dashboard / projects / sites). Mock-backed in the evaluation
  // build; the real data would come from the cloud account + each site's files.
  loadAccount(): Promise<AccountView>;
  listProjects(): Promise<ProjectSummary[]>;
  listSites(projectId: string): Promise<SiteSummary[]>;
  loadSiteStats(siteId: string): Promise<SiteStats>;
  listThemes(): Promise<ThemeSummary[]>;

  // Theme source files — for theme development / part authoring in the code
  // editor. Distinct from operator content editing; writes target a theme
  // working copy, never the original theme files on disk (CLAUDE.md).
  listThemeFiles(): Promise<ThemeFileNode[]>;
  readThemeFile(path: string): Promise<string>;
  writeThemeFile(path: string, content: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// App shell views
// ---------------------------------------------------------------------------

export interface AccountView {
  name: string;
  email: string;
  plan: string;
  /** AI usage this period (CLAUDE.md: ユーザーごとの利用量を記録). */
  ai: { used: number; limit: number };
}

export interface ProjectSummary {
  id: string;
  name: string;
  siteCount: number;
}

export interface SiteSummary {
  id: string;
  name: string;
  domain: string;
  published: boolean;
  stats: { visits: number; inquiries: number };
}

export interface InquiryRow {
  id: string;
  name: string;
  email: string;
  message: string;
  receivedAt: string;
}

export interface SiteStats {
  visits: number;
  inquiries: number;
  pages: number;
  /** Daily visit counts for a small chart (most recent last). */
  visitSeries: number[];
  recentInquiries: InquiryRow[];
}

export interface ThemeSummary {
  id: string;
  name: string;
  description: string;
  current: boolean;
}

export type ThemeFileKind = "html" | "css" | "js" | "json" | "other";

export interface ThemeFileNode {
  /** Theme-relative path, e.g. "sections/hero.html". */
  path: string;
  kind: ThemeFileKind;
}

export interface AiThemeifyResult {
  html: string;
  issues: AiIssue[];
}

export interface AiSeoResult {
  title: string;
  description: string;
}

/** A processed image ready to persist. Bytes are the final WebP file. */
export interface MediaUpload {
  fileName: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface PublishIssue {
  level: "error" | "warning";
  message: string;
  path?: string;
}

export interface PublishPreview {
  issues: PublishIssue[];
  upload: number;
  delete: number;
  unchanged: number;
  target: string;
}

export interface PublishReport {
  ok: boolean;
  issues: PublishIssue[];
  uploaded: number;
  deleted: number;
  unchanged: number;
  error?: string;
  rolledBack?: boolean;
  blocked?: boolean;
  publishedAt?: string;
  target: string;
}

export interface PublishHistoryEntry {
  id: string;
  publishedAt: string;
  fileCount: number;
}

export type DeployConfigView =
  | { type: "local"; dir: string }
  | {
      type: "sftp";
      host: string;
      port: number;
      username: string;
      remoteDir: string;
      hasPassword: boolean;
    };

export type DeployConfigInput =
  | { type: "local"; dir: string }
  | {
      type: "sftp";
      host: string;
      port?: number;
      username: string;
      remoteDir: string;
      password?: string;
    };

declare global {
  interface Window {
    pcms?: PcmsApi;
  }
}
