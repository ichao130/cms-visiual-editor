import { posix } from "node:path";
import type { S3Config, Transport } from "../types.js";
import { toBytes } from "../hash.js";

/**
 * The small set of object operations S3Transport needs. The real implementation
 * (see `loadOps`) wraps `@aws-sdk/client-s3`; tests inject a fake. Keeping the
 * seam at this level means the AWS command objects never leak into the
 * transport, so it stays testable without the SDK installed.
 */
export interface S3ObjectStore {
  putObject(input: { key: string; body: Uint8Array; contentType?: string }): Promise<void>;
  deleteObject(input: { key: string }): Promise<void>;
  /** Return the object's bytes, or null when it does not exist. */
  getObject(input: { key: string }): Promise<Uint8Array | null>;
  close?(): void;
}

/** Content type for a published file, inferred from its extension. */
const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
  webmanifest: "application/manifest+json",
  map: "application/json; charset=utf-8",
};

/** Guess a Content-Type from a path, defaulting to a generic binary type. */
export function contentTypeFor(path: string): string {
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME[ext] ?? "application/octet-stream";
}

/**
 * Amazon S3 (and S3-compatible) transport. `@aws-sdk/client-s3` is imported
 * dynamically so the deploy core stays dependency-free and unit-testable (an
 * object-store factory can be injected); the desktop app provides the real
 * module. Credentials come from the caller and never touch the cloud
 * (CLAUDE.md). Each output file maps to an object key under the optional prefix,
 * with a Content-Type set so static hosting serves it correctly.
 */
export class S3Transport implements Transport {
  private store: S3ObjectStore | null = null;
  private readonly prefix: string;

  constructor(
    private readonly config: S3Config,
    /** Testing seam: supply a fake store instead of loading the AWS SDK. */
    private readonly makeStore?: () => Promise<S3ObjectStore>,
  ) {
    // Normalize the prefix to a clean, slash-free-ends key segment.
    this.prefix = (config.prefix ?? "").replace(/^\/+|\/+$/g, "");
  }

  /** The object key for a site-relative path (S3 keys never start with "/"). */
  private key(path: string): string {
    const rel = path.replace(/^\/+/, "");
    return this.prefix ? posix.join(this.prefix, rel) : rel;
  }

  private async conn(): Promise<S3ObjectStore> {
    if (this.store) return this.store;
    this.store = this.makeStore ? await this.makeStore() : await loadOps(this.config);
    return this.store;
  }

  async put(path: string, data: string | Uint8Array): Promise<void> {
    const store = await this.conn();
    await store.putObject({
      key: this.key(path),
      body: toBytes(data),
      contentType: contentTypeFor(path),
    });
  }

  async delete(path: string): Promise<void> {
    const store = await this.conn();
    // S3 DeleteObject is idempotent — removing a missing key is not an error.
    await store.deleteObject({ key: this.key(path) });
  }

  async get(path: string): Promise<Uint8Array | null> {
    const store = await this.conn();
    return store.getObject({ key: this.key(path) });
  }

  async close(): Promise<void> {
    this.store?.close?.();
    this.store = null;
  }
}

/** True when an S3 error means "no such object" (so get returns null). */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    e?.name === "NoSuchKey" ||
    e?.name === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/** Minimal shape of the AWS SDK pieces we call (loaded at runtime). */
interface AwsS3Module {
  S3Client: new (cfg: Record<string, unknown>) => { send(cmd: unknown): Promise<unknown>; destroy(): void };
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
}

/** Load `@aws-sdk/client-s3` and adapt it to the S3ObjectStore interface. */
async function loadOps(config: S3Config): Promise<S3ObjectStore> {
  const moduleName = "@aws-sdk/client-s3";
  const mod = (await import(moduleName)) as unknown as AwsS3Module;
  if (!mod.S3Client) throw new Error("@aws-sdk/client-s3 の読み込みに失敗しました。");
  const client = new mod.S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  const Bucket = config.bucket;
  return {
    async putObject({ key, body, contentType }) {
      await client.send(
        new mod.PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async deleteObject({ key }) {
      await client.send(new mod.DeleteObjectCommand({ Bucket, Key: key }));
    },
    async getObject({ key }) {
      try {
        const res = (await client.send(new mod.GetObjectCommand({ Bucket, Key: key }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> };
        };
        const bytes = await res.Body?.transformToByteArray();
        return bytes ? new Uint8Array(bytes) : null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    close() {
      client.destroy();
    },
  };
}
