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
import type { PcmsApi } from "../api/types.js";
import { importImages } from "./import.js";
import { MediaLibrary } from "../components/MediaLibrary.js";
import { useToast } from "../state/ToastContext.js";
import { t } from "../i18n.js";

export interface MediaContextValue {
  media: MediaItem[];
  importing: boolean;
  /** Open the library for browsing (import / review). */
  openLibrary: () => void;
  /** Open the library as a picker; resolves with the chosen path, or null. */
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
 * Owns the media library state and the modal. App calls this (so the preview
 * can read `media`), provides `value` through MediaContext for FieldInput, and
 * renders `modal`.
 */
export function useMediaLibrary(api: PcmsApi): {
  value: MediaContextValue;
  modal: ReactNode;
} {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<"closed" | "browse" | "pick">("closed");
  const resolverRef = useRef<((path: string | null) => void) | null>(null);
  const toast = useToast();

  useEffect(() => {
    let active = true;
    void api.listMedia().then((items) => {
      if (active) setMedia(items);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const runImport = useCallback(async () => {
    setImporting(true);
    try {
      const uploads = await importImages();
      if (uploads.length > 0) {
        const saved = await api.saveMedia(uploads);
        setMedia((prev) => mergeMedia(prev, saved));
      }
    } finally {
      setImporting(false);
    }
  }, [api]);

  const deleteMedia = useCallback(
    async (item: MediaItem) => {
      await api.deleteMedia(item.path);
      setMedia((prev) => prev.filter((m) => m.path !== item.path));
      toast(t("toast.mediaDeleted").replace("{name}", item.fileName));
    },
    [api, toast],
  );

  const openLibrary = useCallback(() => setMode("browse"), []);

  const pickImage = useCallback(
    () =>
      new Promise<string | null>((resolve) => {
        resolverRef.current = resolve;
        setMode("pick");
      }),
    [],
  );

  const settle = useCallback((path: string | null) => {
    resolverRef.current?.(path);
    resolverRef.current = null;
    setMode("closed");
  }, []);

  const resolveUrl = useCallback(
    (path: string | undefined) =>
      path ? media.find((m) => m.path === path)?.dataUrl : undefined,
    [media],
  );

  const value = useMemo<MediaContextValue>(
    () => ({ media, importing, openLibrary, pickImage, resolveUrl }),
    [media, importing, openLibrary, pickImage, resolveUrl],
  );

  const modal =
    mode === "closed" ? null : (
      <MediaLibrary
        media={media}
        importing={importing}
        onImport={runImport}
        onSelect={mode === "pick" ? (item) => settle(item.path) : undefined}
        onDelete={mode === "browse" ? deleteMedia : undefined}
        onClose={() => settle(null)}
      />
    );

  return { value, modal };
}
