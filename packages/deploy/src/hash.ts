import { createHash } from "node:crypto";
import type { FileSet, PublishManifest } from "./types.js";

export function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

export function hashContent(data: string | Uint8Array): string {
  return createHash("sha1").update(toBytes(data)).digest("hex");
}

/** Fingerprint every file in a set into a manifest. */
export function manifestOf(files: FileSet, publishedAt = new Date().toISOString()): PublishManifest {
  const entries: PublishManifest["files"] = {};
  for (const [path, data] of Object.entries(files)) {
    const bytes = toBytes(data);
    entries[path] = { hash: hashContent(bytes), size: bytes.byteLength };
  }
  return { publishedAt, files: entries };
}
