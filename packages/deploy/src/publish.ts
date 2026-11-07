import { manifestOf } from "./hash.js";
import { diffManifests } from "./diff.js";
import { withTimeout } from "./timeout.js";
import type {
  FileEntry,
  FileSet,
  ManifestDiff,
  PublishManifest,
  PublishOptions,
  PublishResult,
  Transport,
} from "./types.js";

/** Hard ceiling on the reconciliation listing, mirroring listServerFiles. */
const RECONCILE_LIST_TIMEOUT_MS = 25000;

/**
 * Augment the manifest diff with the destination's *actual* contents: any output
 * file that is not present on the server is forced into the upload set, even if
 * the manifest considered it unchanged. This keeps a changed remote directory, a
 * server wiped behind our back, or a lost/stale manifest from publishing only a
 * partial diff onto an incomplete destination. Deletes are left as the manifest
 * computed them, so files this app never placed are still never touched
 * (CLAUDE.md). If the listing is unavailable, the manifest-only diff stands.
 */
async function reconcileWithServer(
  diff: ManifestDiff,
  next: PublishManifest,
  transport: Transport,
  opts: PublishOptions,
): Promise<ManifestDiff> {
  if (opts.reconcileWithServer === false || typeof transport.list !== "function") return diff;
  let serverPaths: Set<string>;
  try {
    serverPaths = new Set(
      await withTimeout(transport.list(), RECONCILE_LIST_TIMEOUT_MS, "サーバーのファイル一覧取得"),
    );
  } catch {
    return diff; // can't see the server → trust the manifest diff
  }
  const present = (p: string) => serverPaths.has(p);
  const missing = diff.unchanged.filter((p) => !present(p) && p in next.files);
  if (missing.length === 0) return diff;
  return {
    upload: [...diff.upload, ...missing].sort(),
    delete: diff.delete,
    unchanged: diff.unchanged.filter(present),
  };
}

/**
 * Publish a file set over a transport, sending only what changed and deleting
 * only files the previous publish owned. On a mid-publish error, the changes
 * made so far are rolled back (when the transport supports reads).
 */
export async function publish(
  files: FileSet,
  transport: Transport,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const next = manifestOf(files);
  const diff = await reconcileWithServer(
    diffManifests(opts.previousManifest, next),
    next,
    transport,
    opts,
  );

  if (opts.dryRun) {
    return { ok: true, diff, manifest: next, uploaded: [], deleted: [] };
  }

  const prevFiles: Record<string, FileEntry> = opts.previousManifest?.files ?? {};
  const canSnapshot = typeof transport.get === "function";
  const snapshots = new Map<string, Uint8Array | null>();

  // Snapshot files we will overwrite or delete, so we can restore on failure.
  if (canSnapshot) {
    for (const path of diff.upload) {
      if (path in prevFiles) snapshots.set(path, await transport.get!(path));
    }
    for (const path of diff.delete) {
      snapshots.set(path, await transport.get!(path));
    }
  }

  const uploaded: string[] = [];
  const deleted: string[] = [];

  try {
    for (const path of diff.upload) {
      await transport.put(path, files[path] as string | Uint8Array);
      uploaded.push(path);
    }
    for (const path of diff.delete) {
      await transport.delete(path);
      deleted.push(path);
    }
    return { ok: true, diff, manifest: next, uploaded, deleted };
  } catch (err) {
    const rolledBack = await rollback(
      transport,
      uploaded,
      deleted,
      prevFiles,
      snapshots,
    );
    return {
      ok: false,
      diff,
      manifest: opts.previousManifest ?? { publishedAt: "", files: {} },
      uploaded: [],
      deleted: [],
      error: err instanceof Error ? err.message : String(err),
      rolledBack: rolledBack && canSnapshot,
    };
  }
}

async function rollback(
  transport: Transport,
  uploaded: string[],
  deleted: string[],
  prevFiles: Record<string, FileEntry>,
  snapshots: Map<string, Uint8Array | null>,
): Promise<boolean> {
  try {
    for (const path of uploaded) {
      if (path in prevFiles) {
        const snap = snapshots.get(path);
        if (snap != null) await transport.put(path, snap);
      } else {
        await transport.delete(path);
      }
    }
    for (const path of deleted) {
      const snap = snapshots.get(path);
      if (snap != null) await transport.put(path, snap);
    }
    return true;
  } catch {
    return false;
  }
}
