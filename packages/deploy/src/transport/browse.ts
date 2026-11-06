import { posix } from "node:path";
import type { DirEntry } from "../types.js";

/**
 * Sort directory entries for the folder browser: directories first (so the
 * operator can drill down), then files, each group by name (locale-aware,
 * case-insensitive). Mutates and returns the array.
 */
export function sortDirEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });
}

/**
 * The parent of an absolute posix directory, or null at the filesystem root.
 * `dirname("/")` is "/", so the root (and any path whose dirname equals itself)
 * reports no parent — that stops "上へ" at the top.
 */
export function parentOf(dir: string): string | null {
  const parent = posix.dirname(dir);
  return parent === dir ? null : parent;
}
