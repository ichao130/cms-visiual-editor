/**
 * @pcms/deploy — turn a generated site into a published one: write/collect the
 * output, diff it against the last publish, and send only what changed over a
 * transport (local folder, SFTP, …). Node-targeted (fs / network), unlike the
 * engine.
 */

/** An in-memory set of output files: site-relative path → contents. */
export type FileSet = Record<string, string | Uint8Array>;

/** One file's fingerprint in a publish manifest. */
export interface FileEntry {
  /** Content hash (sha1 hex). */
  hash: string;
  /** Byte size. */
  size: number;
}

/**
 * A record of what a publish put on the server. Used to compute the next
 * diff and to know which remote files this app owns (so we never touch files
 * it did not place — CLAUDE.md).
 */
export interface PublishManifest {
  /** ISO timestamp of the publish. */
  publishedAt: string;
  /** path → fingerprint. */
  files: Record<string, FileEntry>;
}

/** The change set between two manifests. */
export interface ManifestDiff {
  upload: string[];
  delete: string[];
  unchanged: string[];
}

export type IssueLevel = "error" | "warning";

/** A pre-publish check result. */
export interface Issue {
  level: IssueLevel;
  message: string;
  /** Output path the issue relates to, if any. */
  path?: string;
}

/**
 * A publish destination. `put`/`delete` move files; `get` (optional) lets
 * publish snapshot current contents so it can roll back on a mid-publish error.
 */
export interface Transport {
  put(path: string, data: string | Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  get?(path: string): Promise<Uint8Array | null>;
  /** Release any held connection. */
  close?(): Promise<void>;
}

export interface PublishOptions {
  /** The manifest of the previous publish, if any. */
  previousManifest?: PublishManifest;
  /** When true, compute the diff but send nothing. */
  dryRun?: boolean;
}

export interface PublishResult {
  ok: boolean;
  diff: ManifestDiff;
  manifest: PublishManifest;
  /** Paths actually uploaded / deleted (empty on dry run). */
  uploaded: string[];
  deleted: string[];
  /** Set when the publish failed and the previous state was restored. */
  error?: string;
  rolledBack?: boolean;
}

export interface SftpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  /** Remote base directory the site is published under. */
  remoteDir: string;
}

/**
 * How the FTP control connection is secured. Plain "ftp" is unencrypted;
 * "ftps" is explicit FTPS (AUTH TLS over the normal port, the common choice on
 * Japanese shared hosting); "ftps-implicit" negotiates TLS from the start
 * (usually port 990).
 */
export type FtpSecurity = "ftp" | "ftps" | "ftps-implicit";

export interface FtpConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  /** Remote base directory the site is published under. */
  remoteDir: string;
  /** Control-connection security (default "ftps"). */
  security?: FtpSecurity;
}

/**
 * Amazon S3 (or an S3-compatible store) as a publish destination. The site's
 * files become objects in `bucket`, optionally under `prefix`. Credentials come
 * from the caller and stay on the machine (CLAUDE.md: never sent to the cloud).
 */
export interface S3Config {
  /** Target bucket name. */
  bucket: string;
  /** AWS region, e.g. "ap-northeast-1". */
  region: string;
  /** Access key id. */
  accessKeyId: string;
  /** Secret access key. Stored encrypted on the machine, never in the cloud. */
  secretAccessKey: string;
  /** Optional key prefix the site is published under (like a remote dir). */
  prefix?: string;
  /**
   * Optional custom endpoint for S3-compatible stores (Cloudflare R2, MinIO, …).
   * When set, path-style addressing is used.
   */
  endpoint?: string;
}
