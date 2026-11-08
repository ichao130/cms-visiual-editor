import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { app, safeStorage } from "electron";
import {
  FtpTransport,
  LocalTransport,
  S3Transport,
  SftpTransport,
  preflight,
  publish,
  withTimeout,
  type FileSet,
  type FtpSecurity,
  type Issue,
  type PublishManifest,
  type Transport,
} from "@pcms/deploy";
import { assembleOutput, contentIssues } from "./project.js";

// --- Config types (mirrored by the editor-ui API) --------------------------

interface LocalConfig {
  type: "local";
  dir: string;
}
interface SftpConfigStored {
  type: "sftp";
  host: string;
  port?: number;
  username: string;
  remoteDir: string;
  /** Encrypted password (safeStorage), base64. Never leaves this machine. */
  passwordEnc?: string;
}
interface FtpConfigStored {
  type: "ftp";
  host: string;
  port?: number;
  username: string;
  remoteDir: string;
  security?: FtpSecurity;
  /** Encrypted password (safeStorage), base64. Never leaves this machine. */
  passwordEnc?: string;
}
interface S3ConfigStored {
  type: "s3";
  bucket: string;
  region: string;
  accessKeyId: string;
  prefix?: string;
  endpoint?: string;
  /** Encrypted secret access key (safeStorage), base64. Never leaves this machine. */
  secretEnc?: string;
}
type DeployConfig = LocalConfig | SftpConfigStored | FtpConfigStored | S3ConfigStored;

export type DeployConfigInput =
  | LocalConfig
  | {
      type: "sftp";
      host: string;
      port?: number;
      username: string;
      remoteDir: string;
      password?: string;
    }
  | {
      type: "ftp";
      host: string;
      port?: number;
      username: string;
      remoteDir: string;
      security?: FtpSecurity;
      password?: string;
    }
  | {
      type: "s3";
      bucket: string;
      region: string;
      accessKeyId: string;
      prefix?: string;
      endpoint?: string;
      /** Plaintext secret from the form; encrypted before storage, never kept as-is. */
      secretAccessKey?: string;
    };

export type DeployConfigView =
  | LocalConfig
  | {
      type: "sftp";
      host: string;
      port: number;
      username: string;
      remoteDir: string;
      hasPassword: boolean;
    }
  | {
      type: "ftp";
      host: string;
      port: number;
      username: string;
      remoteDir: string;
      security: FtpSecurity;
      hasPassword: boolean;
    }
  | {
      type: "s3";
      bucket: string;
      region: string;
      accessKeyId: string;
      prefix: string;
      endpoint: string;
      /** Whether a secret access key is already stored for this bucket/key. */
      hasSecret: boolean;
    };

export interface PublishReport {
  ok: boolean;
  issues: Issue[];
  uploaded: number;
  deleted: number;
  unchanged: number;
  error?: string;
  rolledBack?: boolean;
  blocked?: boolean;
  publishedAt?: string;
  target: string;
}

export interface PublishHistoryEntry {
  id: string;
  publishedAt: string;
  fileCount: number;
}

export interface ServerListing {
  files: string[];
  target: string;
  error?: string;
  /** Technical detail for the error (e.g. the FTP protocol dialogue). */
  detail?: string;
  /** The listing was cut short (the destination holds more than the shown cap). */
  truncated?: boolean;
}

/** One directory level on the server, for the "choose a folder" browser. */
export interface ServerBrowse {
  /** Absolute path of the directory listed (empty when the browse failed). */
  path: string;
  /** Parent directory, or null at the filesystem root / on failure. */
  parent: string | null;
  entries: { name: string; isDirectory: boolean }[];
  /** The directory held more entries than the cap and was cut short. */
  truncated?: boolean;
  /** Raw transport error when the connection/listing failed, for diagnosis. */
  error?: string;
  /** Technical detail for the error (e.g. the FTP protocol dialogue). */
  detail?: string;
}

// --- Paths -----------------------------------------------------------------

const userData = () => app.getPath("userData");
const deployConfigPath = () => join(userData(), "deploy.json");
const pcmsDir = () => {
  const d = join(userData(), ".pcms");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
};
const manifestPath = () => join(pcmsDir(), "manifest.json");
const historyDir = () => {
  const d = join(pcmsDir(), "history");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
};
const defaultPublishedDir = () => join(userData(), "published");

// --- Config ----------------------------------------------------------------

function loadRawConfig(): DeployConfig {
  const path = deployConfigPath();
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as DeployConfig;
    } catch {
      /* fall through to default */
    }
  }
  return { type: "local", dir: defaultPublishedDir() };
}

export function getDeployConfig(): DeployConfigView {
  const cfg = loadRawConfig();
  if (cfg.type === "local") return { type: "local", dir: cfg.dir };
  if (cfg.type === "ftp") {
    const security = cfg.security ?? "ftps";
    return {
      type: "ftp",
      host: cfg.host,
      port: cfg.port ?? (security === "ftps-implicit" ? 990 : 21),
      username: cfg.username,
      remoteDir: cfg.remoteDir,
      security,
      hasPassword: Boolean(cfg.passwordEnc),
    };
  }
  if (cfg.type === "s3") {
    return {
      type: "s3",
      bucket: cfg.bucket,
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      prefix: cfg.prefix ?? "",
      endpoint: cfg.endpoint ?? "",
      hasSecret: Boolean(cfg.secretEnc),
    };
  }
  return {
    type: "sftp",
    host: cfg.host,
    port: cfg.port ?? 22,
    username: cfg.username,
    remoteDir: cfg.remoteDir,
    hasPassword: Boolean(cfg.passwordEnc),
  };
}

/** Encrypt a secret for at-rest storage, or keep the prior value when blank. */
function encryptOrKeep(secret: string | undefined, prev: string | undefined): string | undefined {
  if (secret && safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(secret).toString("base64");
  }
  return prev;
}

export function setDeployConfig(input: DeployConfigInput): void {
  const existing = loadRawConfig();
  let stored: DeployConfig;
  if (input.type === "local") {
    stored = { type: "local", dir: input.dir };
  } else if (input.type === "s3") {
    // Keep the stored secret when the form leaves it blank, as long as the
    // bucket + access key are unchanged — so editing other fields doesn't wipe
    // the saved credential. The secret is stored encrypted and never sent to
    // the cloud (CLAUDE.md).
    const prevEnc =
      existing.type === "s3" &&
      existing.bucket === input.bucket &&
      existing.accessKeyId === input.accessKeyId
        ? existing.secretEnc
        : undefined;
    stored = {
      type: "s3",
      bucket: input.bucket,
      region: input.region,
      accessKeyId: input.accessKeyId,
      prefix: input.prefix || undefined,
      endpoint: input.endpoint || undefined,
      secretEnc: encryptOrKeep(input.secretAccessKey, prevEnc),
    };
  } else {
    // Keep the previously stored password when the form leaves it blank, as long
    // as the server (host+user) is unchanged — so editing other fields doesn't
    // wipe the saved credential.
    const prevEnc =
      (existing.type === "sftp" || existing.type === "ftp") &&
      existing.host === input.host &&
      existing.username === input.username
        ? existing.passwordEnc
        : undefined;
    const passwordEnc = encryptOrKeep(input.password, prevEnc);
    if (input.type === "ftp") {
      stored = {
        type: "ftp",
        host: input.host,
        port: input.port,
        username: input.username,
        remoteDir: input.remoteDir,
        security: input.security ?? "ftps",
        passwordEnc,
      };
    } else {
      stored = {
        type: "sftp",
        host: input.host,
        port: input.port,
        username: input.username,
        remoteDir: input.remoteDir,
        passwordEnc,
      };
    }
  }
  writeFileSync(deployConfigPath(), JSON.stringify(stored, null, 2), "utf8");
}

function decryptPassword(passwordEnc?: string): string | undefined {
  if (passwordEnc && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(Buffer.from(passwordEnc, "base64"));
  }
  return undefined;
}

function makeTransport(cfg: DeployConfig): { transport: Transport; target: string } {
  if (cfg.type === "local") {
    if (!existsSync(cfg.dir)) mkdirSync(cfg.dir, { recursive: true });
    return { transport: new LocalTransport(cfg.dir), target: `フォルダ: ${cfg.dir}` };
  }
  if (cfg.type === "ftp") {
    const security = cfg.security ?? "ftps";
    const transport = new FtpTransport({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: decryptPassword(cfg.passwordEnc),
      remoteDir: cfg.remoteDir,
      security,
    });
    const label = security === "ftp" ? "FTP" : "FTPS";
    return { transport, target: `${label}: ${cfg.username}@${cfg.host}:${cfg.remoteDir}` };
  }
  if (cfg.type === "s3") {
    const transport = new S3Transport({
      bucket: cfg.bucket,
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: decryptPassword(cfg.secretEnc) ?? "",
      prefix: cfg.prefix,
      endpoint: cfg.endpoint,
    });
    const where = cfg.prefix ? `${cfg.bucket}/${cfg.prefix}` : cfg.bucket;
    return { transport, target: `S3: ${where}（${cfg.region}）` };
  }
  const transport = new SftpTransport({
    host: cfg.host,
    port: cfg.port,
    username: cfg.username,
    password: decryptPassword(cfg.passwordEnc),
    remoteDir: cfg.remoteDir,
  });
  return { transport, target: `SFTP: ${cfg.username}@${cfg.host}:${cfg.remoteDir}` };
}

// --- Manifest / history ----------------------------------------------------

function loadManifest(): PublishManifest | undefined {
  const path = manifestPath();
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PublishManifest;
  } catch {
    return undefined;
  }
}

function saveManifest(manifest: PublishManifest): void {
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2), "utf8");
}

function snapshotOutput(id: string, files: FileSet): void {
  const dir = join(historyDir(), id);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof data === "string" ? data : Buffer.from(data));
  }
  writeFileSync(
    join(dir, ".meta.json"),
    JSON.stringify({ publishedAt: new Date().toISOString(), fileCount: Object.keys(files).length }),
    "utf8",
  );
}

function walk(dir: string, base = dir, out: FileSet = {}): FileSet {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out[relative(base, full).split("\\").join("/")] = new Uint8Array(readFileSync(full));
  }
  return out;
}

export function listPublishHistory(): PublishHistoryEntry[] {
  const dir = historyDir();
  const entries: PublishHistoryEntry[] = [];
  for (const id of readdirSync(dir)) {
    const metaPath = join(dir, id, ".meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as {
        publishedAt: string;
        fileCount: number;
      };
      entries.push({ id, publishedAt: meta.publishedAt, fileCount: meta.fileCount });
    } catch {
      /* skip malformed */
    }
  }
  return entries.sort((a, b) => b.id.localeCompare(a.id));
}

// --- Publish / preview / rollback ------------------------------------------

export interface PublishPreview {
  issues: Issue[];
  upload: number;
  delete: number;
  unchanged: number;
  /** Paths that will be uploaded (new or changed since the last publish). */
  uploadPaths: string[];
  /** Paths that will be deleted (present last publish, gone now). */
  deletePaths: string[];
  target: string;
  /** Set when the pre-publish check itself failed (e.g. output generation). */
  error?: string;
  /**
   * Whether the destination's files were read to build the diff: true when the
   * diff reflects the real server, false when the listing failed (the diff is
   * the manifest estimate), undefined when not applicable (full upload). Lets the
   * UI warn that the diff may be incomplete and offer a full upload.
   */
  serverListed?: boolean;
}

export async function previewPublish(full = false): Promise<PublishPreview> {
  const { transport, target } = makeTransport(loadRawConfig());
  try {
    const files = assembleOutput();
    const issues = [...contentIssues(), ...preflight(files)];
    const result = await publish(files, transport, {
      previousManifest: loadManifest(),
      dryRun: true,
      fullUpload: full,
    });
    return {
      issues,
      upload: result.diff.upload.length,
      delete: result.diff.delete.length,
      unchanged: result.diff.unchanged.length,
      uploadPaths: result.diff.upload,
      deletePaths: result.diff.delete,
      target,
      serverListed: result.serverListed,
    };
  } catch (err) {
    // The dry run sends nothing, so a failure here is a generation / config
    // problem (the server listing it does for the diff is caught inside publish).
    // Return it for the UI to diagnose instead of throwing across the IPC
    // boundary (which the renderer would surface as an opaque crash).
    return {
      issues: [],
      upload: 0,
      delete: 0,
      unchanged: 0,
      uploadPaths: [],
      deletePaths: [],
      target,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await transport.close?.();
  }
}

async function runPublish(files: FileSet, full = false): Promise<PublishReport> {
  const issues = [...contentIssues(), ...preflight(files)];
  const { transport, target } = makeTransport(loadRawConfig());

  if (issues.some((i) => i.level === "error")) {
    await transport.close?.();
    return { ok: false, blocked: true, issues, uploaded: 0, deleted: 0, unchanged: 0, target };
  }

  const result = await publish(files, transport, {
    previousManifest: loadManifest(),
    fullUpload: full,
  });
  await transport.close?.();

  if (result.ok) {
    saveManifest(result.manifest);
    snapshotOutput(result.manifest.publishedAt.replace(/[:.]/g, "-"), files);
  }

  return {
    ok: result.ok,
    issues,
    uploaded: result.uploaded.length,
    deleted: result.deleted.length,
    unchanged: result.diff.unchanged.length,
    error: result.error,
    rolledBack: result.rolledBack,
    publishedAt: result.ok ? result.manifest.publishedAt : undefined,
    target,
  };
}

export function publishSite(full = false): Promise<PublishReport> {
  return runPublish(assembleOutput(), full);
}

export async function rollbackPublish(id: string): Promise<PublishReport> {
  const dir = join(historyDir(), id);
  if (!existsSync(dir)) {
    return { ok: false, issues: [], uploaded: 0, deleted: 0, unchanged: 0, target: "", error: "履歴が見つかりません" };
  }
  return runPublish(walk(dir));
}

// --- File listings (local output vs. what is on the server) ----------------

/** The files the current site generates — what a publish would send. */
export function listLocalFiles(): string[] {
  return Object.keys(assembleOutput()).sort();
}

/**
 * Connect to the configured destination and list the files that are there now
 * (bounded to the site's root). One-shot: connect, list, disconnect. A
 * connection failure is returned as `error` (the UI diagnoses it) rather than
 * thrown. Connection details stay on this machine (CLAUDE.md).
 */
export async function listServerFiles(): Promise<ServerListing> {
  const { transport, target } = makeTransport(loadRawConfig());
  try {
    // A hard ceiling over the whole connect + list: the listing opens a data
    // connection (passive mode), which can stall independently of the control
    // connection. Without this the "接続して取得" button could sit on 接続中…
    // forever. 25s leaves room for a slow connect (≤20s) plus the listing.
    const files =
      typeof transport.list === "function"
        ? await withTimeout(transport.list(), 25000, "サーバーのファイル一覧取得")
        : [];
    const truncated = transport.listTruncated?.() ?? false;
    return { files, target, ...(truncated ? { truncated } : {}) };
  } catch (err) {
    const detail = transport.diagnostics?.();
    return {
      files: [],
      target,
      error: err instanceof Error ? err.message : String(err),
      ...(detail ? { detail } : {}),
    };
  } finally {
    await transport.close?.();
  }
}

/**
 * List one directory level on the configured server so the operator can browse
 * and choose the publish folder (`remoteDir`) without knowing its path in
 * advance. `path === ""` starts at the login directory. One-shot: connect, list,
 * disconnect. Only FTP/SFTP support browsing; other targets report so. A failure
 * is returned as `error` rather than thrown. Uses the saved connection details,
 * which stay on this machine (CLAUDE.md).
 */
export async function browseServer(path: string): Promise<ServerBrowse> {
  const { transport } = makeTransport(loadRawConfig());
  try {
    if (typeof transport.browse !== "function") {
      return {
        path: "",
        parent: null,
        entries: [],
        error: "この公開先はフォルダ参照に対応していません。",
      };
    }
    // Same hard ceiling as the file listing: a browse opens a passive data
    // connection that can stall independently of the control connection.
    const r = await withTimeout(transport.browse(path), 25000, "サーバーのフォルダ参照");
    return {
      path: r.path,
      parent: r.parent,
      entries: r.entries,
      ...(r.truncated ? { truncated: true } : {}),
    };
  } catch (err) {
    const detail = transport.diagnostics?.();
    return {
      path: "",
      parent: null,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
      ...(detail ? { detail } : {}),
    };
  } finally {
    await transport.close?.();
  }
}
