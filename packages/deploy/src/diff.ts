import type { ManifestDiff, PublishManifest } from "./types.js";

const EMPTY: PublishManifest = { publishedAt: "", files: {} };

/**
 * Compute what must change to go from `prev` to `next`:
 * upload new/changed files, delete files that are gone. Deletions are scoped to
 * paths the previous manifest owned, so files this app never placed are never
 * touched (CLAUDE.md).
 */
export function diffManifests(
  prev: PublishManifest | undefined,
  next: PublishManifest,
): ManifestDiff {
  const previous = prev ?? EMPTY;
  const upload: string[] = [];
  const unchanged: string[] = [];

  for (const [path, entry] of Object.entries(next.files)) {
    const before = previous.files[path];
    if (before && before.hash === entry.hash) unchanged.push(path);
    else upload.push(path);
  }

  const del: string[] = [];
  for (const path of Object.keys(previous.files)) {
    if (!(path in next.files)) del.push(path);
  }

  return {
    upload: upload.sort(),
    delete: del.sort(),
    unchanged: unchanged.sort(),
  };
}
