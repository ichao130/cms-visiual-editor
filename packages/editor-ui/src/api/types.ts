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
  VisitStats,
  CloudStatus,
} from "@pcms/shared";
import type { AiIssue, BackupRef, EncryptedBackup, ThemeBundle } from "@pcms/engine";

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
  /**
   * Binary theme assets (images/fonts under `assets/`), keyed by theme-relative
   * path (e.g. "assets/bg.webp") with a `data:` URL value. Used to inline asset
   * references into the sandboxed preview and to show image assets in the editor.
   */
  themeAssets: Record<string, string>;
  /**
   * Text theme assets (CSS / JS / SVG under `assets/`), keyed by theme-relative
   * path with the file's text as value. The live preview inlines the auto-linked
   * CSS / JS from here (a sandboxed `srcdoc` can't fetch `assets/…`), so operator
   * stylesheets and scripts take effect in the preview just as they do when
   * published. Optional for older producers.
   */
  themeTextAssets?: Record<string, string>;
}

/**
 * The entire surface the renderer may call. Implemented by the Electron
 * preload (`window.pcms`) over IPC, and by a mock for the browser dev harness.
 * The editor UI must use only this — never Electron APIs directly.
 */
export interface PcmsApi {
  loadProject(): Promise<ProjectData>;
  /** Persist the site-wide config (site.json): name, base URL, permalink, etc. */
  saveSite(site: SiteConfig): Promise<void>;
  /** Persist the operator's page edits (settings.json). */
  saveDraft(settings: SiteSettings): Promise<void>;
  /** Persist content items (content/<type>/<slug>.md). */
  saveContent(content: ContentItem[]): Promise<void>;
  /** List media already stored for the site (with data URLs for display). */
  listMedia(): Promise<MediaItem[]>;
  /**
   * Persist imported, already-processed (WebP) images; returns their records.
   * `folder` files them under that media folder (empty = the unfiled root).
   */
  saveMedia(files: MediaUpload[], folder?: string): Promise<MediaItem[]>;
  /** Remove a stored media file by its path (e.g. "media/foo.webp"). */
  deleteMedia(path: string): Promise<void>;
  /** Set the default alt text for a stored media file. */
  setMediaAlt(path: string, alt: string): Promise<void>;
  /** Move a stored media file into a folder (empty string = the unfiled root). */
  setMediaFolder(path: string, folder: string): Promise<void>;
  /** List the media folders, including empty ones the operator created. */
  listMediaFolders(): Promise<string[]>;
  /** Create an empty media folder. */
  createMediaFolder(name: string): Promise<void>;
  /** Delete a media folder; its items move back to the unfiled root. */
  deleteMediaFolder(name: string): Promise<void>;
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
  previewPublish(full?: boolean): Promise<PublishPreview>;
  /**
   * Publish the site (diff upload + delete, with rollback on failure). Pass
   * full=true to upload every file regardless of the diff (a full re-publish).
   */
  publishSite(full?: boolean): Promise<PublishReport>;
  listPublishHistory(): Promise<PublishHistoryEntry[]>;
  /** Re-publish a previous snapshot. */
  rollbackPublish(id: string): Promise<PublishReport>;
  /** The files the current site generates — what a publish would send. */
  listLocalFiles(): Promise<string[]>;
  /**
   * Connect to the configured destination and list the files that are there
   * now (under the site's root). One-shot: connects, lists, disconnects. On a
   * connection failure, `error` carries the raw transport message for diagnosis.
   */
  listServerFiles(): Promise<ServerListing>;
  /**
   * List one directory level on the configured server so the operator can browse
   * and pick the publish folder (`remoteDir`) without knowing its path up front.
   * `path === ""` starts at the login directory. Only FTP/SFTP support browsing.
   */
  browseServer(path: string): Promise<ServerBrowse>;

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
  /** Create a project; returns its summary. */
  createProject(name: string): Promise<ProjectSummary>;
  /** Delete a project (and drop it from the listing). */
  deleteProject(projectId: string): Promise<void>;
  /** Rename a project. */
  renameProject(projectId: string, name: string): Promise<void>;
  listSites(projectId: string): Promise<SiteSummary[]>;
  /** Create a site under a project; returns its summary. */
  createSite(projectId: string, name: string): Promise<SiteSummary>;
  /** Delete a site from a project. */
  deleteSite(projectId: string, siteId: string): Promise<void>;
  /** Rename a site. */
  renameSite(projectId: string, siteId: string, name: string): Promise<void>;
  loadSiteStats(siteId: string): Promise<SiteStats>;
  /**
   * Visit numbers from the configured analytics provider (GA4 / MOKKEDA) via the
   * Firebase proxy, or deterministic sample data when none is configured
   * (source "mock"). `days` is the window size (default 14).
   */
  fetchVisitStats(siteId: string, days?: number): Promise<VisitStats>;
  listThemes(): Promise<ThemeSummary[]>;

  // Theme source files — for theme development / part authoring in the code
  // editor. Distinct from operator content editing; writes target a theme
  // working copy, never the original theme files on disk (CLAUDE.md).
  listThemeFiles(): Promise<ThemeFileNode[]>;
  readThemeFile(path: string): Promise<string>;
  writeThemeFile(path: string, content: string): Promise<void>;
  /**
   * Store a binary theme asset (image/font) under `assets/` in the working copy.
   * Bytes are kept as a data URL (the working copy is string-only). Text assets
   * (CSS/JS/HTML/SVG) use writeThemeFile instead.
   */
  writeThemeAsset(path: string, bytes: Uint8Array): Promise<void>;
  /** Remove a working-copy file: deletes a created part, or reverts an edited
   *  original back to the theme's version. */
  deleteThemeFile(path: string): Promise<void>;
  /** Rename a created part (working-copy file) to a new path. */
  renameThemeFile(from: string, to: string): Promise<void>;
  /** Discard the whole working copy — back to the original theme files. */
  resetTheme(): Promise<void>;

  // Contact forms. The builder's definitions persist here; submissions are
  // received by the Firebase function in production (sample data in the mock).
  listForms(): Promise<FormDef[]>;
  saveForms(siteId: string, forms: FormDef[]): Promise<void>;
  listSubmissions(siteId: string, formId: string): Promise<FormSubmission[]>;
  /**
   * The live submitForm endpoint + cloud siteId for the embed snippet, so the
   * deployed form posts where saveForms registered it. Null when signed out /
   * cloud not configured (the embed then shows a placeholder endpoint).
   */
  cloudFormTarget(siteId: string): Promise<{ endpoint: string; siteId: string } | null>;

  // Redirects (redirects.json). Auto-added when the permalink pattern changes,
  // and editable here so the operator can review, add or remove mappings.
  loadRedirects(): Promise<Redirect[]>;
  saveRedirects(redirects: Redirect[]): Promise<void>;
  /**
   * Encrypted, zero-knowledge backup of all site data (never the deploy /
   * connection config). The passphrase encrypts client-side before the blob
   * leaves the machine; restoring applies the decrypted data.
   */
  createBackup(passphrase: string): Promise<EncryptedBackup>;
  restoreBackup(backup: EncryptedBackup, passphrase: string): Promise<void>;
  /**
   * Save an encrypted backup to the backup store (cloud in a real build, local
   * history in the eval / desktop), and manage that history. Only ciphertext is
   * ever stored — the store never sees the passphrase.
   */
  uploadBackup(passphrase: string): Promise<BackupRef>;
  listBackups(): Promise<BackupRef[]>;
  restoreFromBackup(id: string, passphrase: string): Promise<void>;
  deleteBackup(id: string): Promise<void>;

  /** Cloud (Firebase) connection status: configured on this PC, and signed in. */
  cloudStatus(): Promise<CloudStatus>;
  /** Start Google sign-in (opens the system browser); resolves with the new status. */
  signIn(): Promise<CloudStatus>;
  /** Forget the local Firebase session; resolves with the new status. */
  signOut(): Promise<CloudStatus>;
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

export type ThemeFileKind = "html" | "css" | "js" | "json" | "image" | "other";

export interface ThemeFileNode {
  /** Theme-relative path, e.g. "sections/hero.html". */
  path: string;
  kind: ThemeFileKind;
  /** Created in the code editor (not part of the original theme). */
  custom?: boolean;
  /** An original theme file that has unsaved-to-theme edits in the working copy. */
  edited?: boolean;
  /** Binary asset (image/font): not text-editable; readThemeFile returns a data URL. */
  binary?: boolean;
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
  /** Paths that will be uploaded (new or changed since the last publish). */
  uploadPaths: string[];
  /** Paths that will be deleted (present last publish, gone now). */
  deletePaths: string[];
  target: string;
  /** Set when the pre-publish check itself failed (e.g. output generation). */
  error?: string;
  /**
   * Whether the destination's files were read for the diff: true = reflects the
   * real server, false = listing failed so the diff is the manifest estimate,
   * undefined = not applicable (full upload). When false, the UI warns the diff
   * may be incomplete and offers a full upload.
   */
  serverListed?: boolean;
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

/** The files currently on the publish destination (server / folder). */
export interface ServerListing {
  /** Site-relative paths present at the destination. Empty when offline/failed. */
  files: string[];
  /** Human-readable destination label (same as a publish report's target). */
  target: string;
  /** Raw transport error when the connection/listing failed, for diagnosis. */
  error?: string;
  /** Technical detail for the error (e.g. the FTP protocol dialogue). */
  detail?: string;
  /** The listing was cut short (the destination holds more than the shown cap). */
  truncated?: boolean;
}

/** One directory level on the server, for the "choose a folder" browser. */
export interface ServerBrowse {
  /** Absolute path of the directory listed (empty when the browse failed). */
  path: string;
  /** Parent directory, or null at the filesystem root / on failure. */
  parent: string | null;
  /** Entries in this directory (directories first). */
  entries: { name: string; isDirectory: boolean }[];
  /** The directory held more entries than the cap and was cut short. */
  truncated?: boolean;
  /** Raw transport error when the connection/listing failed, for diagnosis. */
  error?: string;
  /** Technical detail for the error (e.g. the FTP protocol dialogue). */
  detail?: string;
}

/** FTP control-connection security (mirrors @pcms/deploy's FtpSecurity). */
export type FtpSecurity = "ftp" | "ftps" | "ftps-implicit";

export type DeployConfigView =
  | { type: "local"; dir: string }
  | {
      type: "sftp";
      host: string;
      port: number;
      username: string;
      remoteDir: string;
      hasPassword: boolean;
    }
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

export type DeployConfigInput =
  | { type: "local"; dir: string }
  | {
      type: "sftp";
      host: string;
      port?: number;
      username: string;
      remoteDir: string;
      password?: string;
    }
  | {
      type: "ftp";
      host: string;
      port?: number;
      username: string;
      remoteDir: string;
      security?: FtpSecurity;
      password?: string;
    }
  | {
      type: "s3";
      bucket: string;
      region: string;
      accessKeyId: string;
      prefix?: string;
      endpoint?: string;
      secretAccessKey?: string;
    };

declare global {
  interface Window {
    pcms?: PcmsApi;
  }
}
