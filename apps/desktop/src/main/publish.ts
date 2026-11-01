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
  SftpTransport,
  preflight,
  publish,
  type FileSet,
  type FtpSecurity,
  type Issue,
  type PublishManifest,
  type Transport,
} from "@pcms/deploy";
import { assembleOutput } from "./project.js";

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
type DeployConfig = LocalConfig | SftpConfigStored | FtpConfigStored;

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
  return {
    type: "sftp",
    host: cfg.host,
    port: cfg.port ?? 22,
    username: cfg.username,
    remoteDir: cfg.remoteDir,
    hasPassword: Boolean(cfg.passwordEnc),
  };
}

export function setDeployConfig(input: DeployConfigInput): void {
  let stored: DeployConfig;
  if (input.type === "local") {
    stored = { type: "local", dir: input.dir };
  } else {
    // Keep the previously stored password when the form leaves it blank, as long
    // as the server (host+user) is unchanged — so editing other fields doesn't
    // wipe the saved credential.
    const existing = loadRawConfig();
    const prevEnc =
      (existing.type === "sftp" || existing.type === "ftp") &&
      existing.host === input.host &&
      existing.username === input.username
        ? existing.passwordEnc
        : undefined;
    let passwordEnc = prevEnc;
    if (input.password && safeStorage.isEncryptionAvailable()) {
      passwordEnc = safeStorage.encryptString(input.password).toString("base64");
    }
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
  target: string;
}

export async function previewPublish(): Promise<PublishPreview> {
  const files = assembleOutput();
  const issues = preflight(files);
  const { transport, target } = makeTransport(loadRawConfig());
  const result = await publish(files, transport, {
    previousManifest: loadManifest(),
    dryRun: true,
  });
  await transport.close?.();
  return {
    issues,
    upload: result.diff.upload.length,
    delete: result.diff.delete.length,
    unchanged: result.diff.unchanged.length,
    target,
  };
}

async function runPublish(files: FileSet): Promise<PublishReport> {
  const issues = preflight(files);
  const { transport, target } = makeTransport(loadRawConfig());

  if (issues.some((i) => i.level === "error")) {
    await transport.close?.();
    return { ok: false, blocked: true, issues, uploaded: 0, deleted: 0, unchanged: 0, target };
  }

  const result = await publish(files, transport, { previousManifest: loadManifest() });
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

export function publishSite(): Promise<PublishReport> {
  return runPublish(assembleOutput());
}

export async function rollbackPublish(id: string): Promise<PublishReport> {
  const dir = join(historyDir(), id);
  if (!existsSync(dir)) {
    return { ok: false, issues: [], uploaded: 0, deleted: 0, unchanged: 0, target: "", error: "履歴が見つかりません" };
  }
  return runPublish(walk(dir));
}
