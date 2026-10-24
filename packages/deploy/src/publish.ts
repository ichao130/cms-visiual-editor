import { manifestOf } from "./hash.js";
import { diffManifests } from "./diff.js";
import type {
  FileEntry,
  FileSet,
  PublishOptions,
  PublishResult,
  Transport,
} from "./types.js";

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
  const diff = diffManifests(opts.previousManifest, next);

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
