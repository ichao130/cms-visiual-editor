import type {
  ContentItem,
  ContentTypeDef,
  MediaItem,
  MenuItem,
  SiteConfig,
  SiteSettings,
} from "@pcms/shared";
import type { ThemeBundle } from "@pcms/engine";

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
}

/** A processed image ready to persist. Bytes are the final WebP file. */
export interface MediaUpload {
  fileName: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
}

declare global {
  interface Window {
    pcms?: PcmsApi;
  }
}
