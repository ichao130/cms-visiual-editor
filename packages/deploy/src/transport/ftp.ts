import { posix } from "node:path";
import { Readable, Writable } from "node:stream";
import type { FtpConfig, Transport } from "../types.js";
import { toBytes } from "../hash.js";

/**
 * Minimal surface of `basic-ftp`'s Client that we use (loaded dynamically).
 * Only the methods needed for a diff publish are listed.
 */
export interface FtpClientLike {
  access(opts: Record<string, unknown>): Promise<unknown>;
  pwd(): Promise<string>;
  ensureDir(remoteDir: string): Promise<unknown>;
  uploadFrom(source: Readable, toRemotePath: string): Promise<unknown>;
  remove(remotePath: string): Promise<unknown>;
  downloadTo(dest: Writable, fromRemotePath: string): Promise<unknown>;
  list(path?: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  close(): void;
}

/** A thrown FTP error carries the numeric reply code (550 = no such file). */
function replyCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "number" ? code : undefined;
}

/**
 * FTP / FTPS transport. `basic-ftp` is imported dynamically so the deploy core
 * stays dependency-free and unit-testable (a client factory can be injected);
 * the desktop app provides the real module. FTPS (explicit "ftps" or
 * "ftps-implicit") is the default because plain FTP sends the password in the
 * clear. Connection details come from the caller and never touch the cloud.
 *
 * Remote paths are resolved to absolute once (against the login directory) so
 * uploads, deletes and directory creation never depend on the connection's
 * current working directory.
 */
export class FtpTransport implements Transport {
  private client: FtpClientLike | null = null;
  private root = "";
  private readonly ensured = new Set<string>();

  constructor(
    private readonly config: FtpConfig,
    /** Testing seam: supply a fake client instead of loading `basic-ftp`. */
    private readonly makeClient?: () => Promise<FtpClientLike>,
  ) {}

  private async loadClient(): Promise<FtpClientLike> {
    if (this.makeClient) return this.makeClient();
    const moduleName = "basic-ftp";
    const mod = (await import(moduleName)) as { Client?: new () => FtpClientLike };
    const Client = mod.Client;
    if (!Client) throw new Error("basic-ftp の読み込みに失敗しました。");
    return new Client();
  }

  private async conn(): Promise<FtpClientLike> {
    if (this.client) return this.client;
    const client = await this.loadClient();
    const security = this.config.security ?? "ftps";
    await client.access({
      host: this.config.host,
      port: this.config.port ?? (security === "ftps-implicit" ? 990 : 21),
      user: this.config.username,
      password: this.config.password,
      secure: security === "ftp" ? false : security === "ftps-implicit" ? "implicit" : true,
    });
    const base = this.config.remoteDir || ".";
    if (base.startsWith("/")) {
      this.root = posix.normalize(base);
    } else {
      const pwd = await client.pwd();
      this.root = posix.normalize(posix.join(pwd || "/", base));
    }
    this.client = client;
    return client;
  }

  private remote(path: string): string {
    return posix.join(this.root, path);
  }

  private async ensureDir(remoteFile: string): Promise<void> {
    const dir = posix.dirname(remoteFile);
    if (this.ensured.has(dir)) return;
    const client = await this.conn();
    await client.ensureDir(dir);
    this.ensured.add(dir);
  }

  async put(path: string, data: string | Uint8Array): Promise<void> {
    const client = await this.conn();
    const remote = this.remote(path);
    await this.ensureDir(remote);
    await client.uploadFrom(Readable.from(Buffer.from(toBytes(data))), remote);
  }

  async delete(path: string): Promise<void> {
    const client = await this.conn();
    try {
      await client.remove(this.remote(path));
    } catch (err) {
      if (replyCode(err) !== 550) throw err; // 550 = already gone, fine
    }
  }

  async get(path: string): Promise<Uint8Array | null> {
    const client = await this.conn();
    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    try {
      await client.downloadTo(sink, this.remote(path));
    } catch (err) {
      if (replyCode(err) === 550) return null; // no such file
      throw err;
    }
    return new Uint8Array(Buffer.concat(chunks));
  }

  async list(): Promise<string[]> {
    const client = await this.conn();
    const out: string[] = [];
    await this.walk(client, this.root, "", out);
    return out.sort();
  }

  private async walk(
    client: FtpClientLike,
    remoteDir: string,
    rel: string,
    out: string[],
  ): Promise<void> {
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = await client.list(remoteDir);
    } catch (err) {
      if (replyCode(err) === 550) return; // missing directory → nothing there
      throw err;
    }
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const childRel = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory) {
        await this.walk(client, posix.join(remoteDir, entry.name), childRel, out);
      } else {
        out.push(childRel);
      }
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}
