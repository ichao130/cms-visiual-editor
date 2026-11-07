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

/** One entry in a single-level server directory listing (for path browsing). */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * The contents of one server directory, returned by `Transport.browse` so the
 * operator can walk the server and pick the publish folder without knowing its
 * path in advance.
 */
export interface DirListing {
  /** Absolute path of the directory that was listed (posix separators). */
  path: string;
  /** The parent directory, or null when already at the filesystem root. */
  parent: string | null;
  /** Entries in this directory (directories first), excluding "." and "..". */
  entries: DirEntry[];
  /** True when the directory held more entries than the cap and was cut short. */
  truncated?: boolean;
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
  /**
   * List the files that currently exist under the destination's root, as
   * site-relative paths (posix separators). Optional — used to show the operator
   * what is on the server, not needed to publish. Bounded to the publish root so
   * it never walks the whole server.
   */
  list?(): Promise<string[]>;
  /**
   * Whether the most recent list() was cut short by a size/depth/time limit
   * (e.g. the destination holds a whole existing site). Optional.
   */
  listTruncated?(): boolean;
  /**
   * List ONE directory level at an absolute server path, so the operator can
   * browse the server and choose the publish folder without knowing its path up
   * front (like a desktop FTP client). `path === ""` means the login/home
   * directory. Navigation is by absolute path and is independent of the
   * configured remoteDir. Optional — not needed to publish.
   */
  browse?(path: string): Promise<DirListing>;
  /** Release any held connection. */
  close?(): Promise<void>;
  /**
   * Recent protocol dialogue for error reporting (e.g. the FTP command/response
   * log), shown in the UI's technical detail when a connection fails. Optional;
   * secrets (passwords) are masked by the transport. Never needed to publish.
   */
  diagnostics?(): string | undefined;
}

export interface PublishOptions {
  /** The manifest of the previous publish, if any. */
  previousManifest?: PublishManifest;
  /** When true, compute the diff but send nothing. */
  dryRun?: boolean;
  /**
   * Reconcile the diff against the destination's actual file listing, so any
   * output file missing on the server is (re)uploaded even if the manifest
   * thought it was unchanged — this is what makes a changed remote directory, a
   * wiped server, or a lost manifest publish the whole site instead of only the
   * manifest diff. Defaults to on when the transport can list; set false to
   * force a manifest-only diff (tests, or when a listing is known to be
   * unreliable). If the listing fails, publish falls back to the manifest diff.
   */
  reconcileWithServer?: boolean;
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
  /** Connection timeout in ms (default 20000). 0 waits indefinitely. */
  timeoutMillis?: number;
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
  /** Connection timeout in ms (default 20000). 0 waits indefinitely. */
  timeoutMillis?: number;
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
