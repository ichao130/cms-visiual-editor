import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { MediaItem } from "@pcms/shared";
import { mediaUsageCounts } from "@pcms/engine";
import type { PcmsApi } from "../api/types.js";
import { importImages } from "./import.js";
import { MediaLibrary } from "../components/MediaLibrary.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

export interface MediaContextValue {
  media: MediaItem[];
  /** Folders the operator created, plus any in use by items (sorted, unique). */
  folders: string[];
  importing: boolean;
  /** Reference count per media path across the site (for "used N times"). */
  usage: Record<string, number>;
  /** Import images, filing them under `folder` ("" = the unfiled root). */
  importInto: (folder: string) => Promise<void>;
  remove: (item: MediaItem) => Promise<void>;
  removeMany: (items: MediaItem[]) => Promise<void>;
  setAlt: (item: MediaItem, alt: string) => Promise<void>;
  setFolder: (item: MediaItem, folder: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  deleteFolder: (name: string) => Promise<void>;
  /** Recompute usage counts from the current site document. */
  refreshUsage: () => void;
  /** Open the picker; resolves with the chosen path, or null. */
  pickImage: () => Promise<string | null>;
  /** Map a stored media path to its data URL for in-editor display. */
  resolveUrl: (path: string | undefined) => string | undefined;
}

const MediaContext = createContext<MediaContextValue | null>(null);
export { MediaContext };

export function useMedia(): MediaContextValue {
  const ctx = useContext(MediaContext);
  if (!ctx) throw new Error("useMedia must be used within a MediaContext");
  return ctx;
}

function mergeMedia(prev: MediaItem[], saved: MediaItem[]): MediaItem[] {
  const byPath = new Map(prev.map((m) => [m.path, m]));
  for (const s of saved) byPath.set(s.path, s);
  return [...byPath.values()];
}

/**
 * Owns the media library state. App calls this (so the preview can read
 * `media`), provides `value` through MediaContext for the media manager and
 * field pickers, and renders the picker `modal`. Browsing/managing media is a
 * full-page view (MediaView), not a modal — only image picking is a dialog.
 */
export function useMediaLibrary(api: PcmsApi): {
  value: MediaContextValue;
  modal: ReactNode;
} {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const resolverRef = useRef<((path: string | null) => void) | null>(null);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    void api.listMedia().then((items) => active && setMedia(items));
    void api.listMediaFolders().then((fs) => active && setFolders(fs));
    return () => {
      active = false;
    };
  }, [api]);

  const refreshFolders = useCallback(() => {
    void api.listMediaFolders().then(setFolders);
  }, [api]);

  const importInto = useCallback(
    async (folder: string) => {
      setImporting(true);
      try {
        const uploads = await importImages();
        if (uploads.length > 0) {
          const saved = await api.saveMedia(uploads, folder || undefined);
          setMedia((prev) => mergeMedia(prev, saved));
        }
      } finally {
        setImporting(false);
      }
    },
    [api],
  );

  const remove = useCallback(
    async (item: MediaItem) => {
      await api.deleteMedia(item.path);
      setMedia((prev) => prev.filter((m) => m.path !== item.path));
      toast(t("toast.mediaDeleted").replace("{name}", item.fileName));
    },
    [api, toast],
  );

  const removeMany = useCallback(
    async (items: MediaItem[]) => {
      const paths = new Set(items.map((m) => m.path));
      for (const item of items) await api.deleteMedia(item.path);
      setMedia((prev) => prev.filter((m) => !paths.has(m.path)));
      toast(t("toast.mediaDeletedMany").replace("{count}", String(items.length)));
    },
    [api, toast],
  );

  const setAlt = useCallback(
    async (item: MediaItem, alt: string) => {
      await api.setMediaAlt(item.path, alt);
      setMedia((prev) => prev.map((m) => (m.path === item.path ? { ...m, alt } : m)));
    },
    [api],
  );

  const setFolder = useCallback(
    async (item: MediaItem, folder: string) => {
      await api.setMediaFolder(item.path, folder);
      setMedia((prev) =>
        prev.map((m) => (m.path === item.path ? { ...m, folder: folder || undefined } : m)),
      );
    },
    [api],
  );

  const createFolder = useCallback(
    async (name: string) => {
      await api.createMediaFolder(name);
      refreshFolders();
    },
    [api, refreshFolders],
  );

  const deleteFolder = useCallback(
    async (name: string) => {
      await api.deleteMediaFolder(name);
      setMedia((prev) => prev.map((m) => (m.folder === name ? { ...m, folder: undefined } : m)));
      refreshFolders();
    },
    [api, refreshFolders],
  );

  const refreshUsage = useCallback(() => {
    void api.loadProject().then((project) => {
      setUsage(mediaUsageCounts(project, media.map((m) => m.path)));
    });
  }, [api, media]);

  const pickImage = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
        setPicking(true);
      }),
    [],
  );

  const settle = useCallback((path: string | null) => {
    resolverRef.current?.(path);
    resolverRef.current = null;
    setPicking(false);
  }, []);

  const resolveUrl = useCallback(
    (path: string | undefined) =>
      path ? media.find((m) => m.path === path)?.dataUrl : undefined,
    [media],
  );

  const value = useMemo<MediaContextValue>(
    () => ({
      media,
      folders,
      importing,
      usage,
      importInto,
      remove,
      removeMany,
      setAlt,
      setFolder,
      createFolder,
      deleteFolder,
      refreshUsage,
      pickImage,
      resolveUrl,
    }),
    [
      media,
      folders,
      importing,
      usage,
      importInto,
      remove,
      removeMany,
      setAlt,
      setFolder,
      createFolder,
      deleteFolder,
      refreshUsage,
      pickImage,
      resolveUrl,
    ],
  );

  // Only the picker is a modal now; browsing/managing is the MediaView page.
  const modal = picking ? (
    <MediaLibrary
      media={media}
      importing={importing}
      onImport={() => importInto("")}
      onSelect={(item) => settle(item.path)}
      onClose={() => settle(null)}
    />
  ) : null;

  return { value, modal };
}
