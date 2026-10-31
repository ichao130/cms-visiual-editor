/**
 * Pure publish-diff helpers, kept out of mock.ts so they can be unit-tested
 * (mock.ts pulls in `?raw` theme imports that the test runner can't load).
 */

export interface PublishDiffResult {
  upload: string[];
  delete: string[];
  unchanged: string[];
}

/** A cheap, stable content hash for change detection. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/** A content-hash manifest (path → hash) for a set of output files. */
export function manifestOf(files: Record<string, string>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) m[path] = hashString(data);
  return m;
}

/**
 * Diff a freshly generated manifest against the last published one: which paths
 * are new/changed (upload), gone (delete) or identical (unchanged). A missing
 * previous manifest means a first publish, so everything uploads. Deletions are
 * only paths the previous publish owned (CLAUDE.md: never touch other files).
 */
export function publishDiff(
  prev: Record<string, string> | null,
  next: Record<string, string>,
): PublishDiffResult {
  const previous = prev ?? {};
  const upload: string[] = [];
  const unchanged: string[] = [];
  for (const [path, hash] of Object.entries(next)) {
    if (previous[path] === hash) unchanged.push(path);
    else upload.push(path);
  }
  const del: string[] = [];
  for (const path of Object.keys(previous)) if (!(path in next)) del.push(path);
  return { upload: upload.sort(), delete: del.sort(), unchanged: unchanged.sort() };
}
