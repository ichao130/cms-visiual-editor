import { posix } from "node:path";
import { Readable, Writable } from "node:stream";
import type { FtpConfig, Transport } from "../types.js";
import { toBytes } from "../hash.js";
import { withTimeout, DEFAULT_CONNECT_TIMEOUT_MS } from "../timeout.js";

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
  /** Recent FTP dialogue (passwords masked by basic-ftp), for error reports. */
  private readonly logLines: string[] = [];

  constructor(
    private readonly config: FtpConfig,
    /** Testing seam: supply a fake client instead of loading `basic-ftp`. */
    private readonly makeClient?: () => Promise<FtpClientLike>,
  ) {}

  private pushLog(line: string): void {
    // basic-ftp logs "> PASS ###" (password already masked). Keep a bounded tail.
    this.logLines.push(line.replace(/\s+$/, ""));
    if (this.logLines.length > 80) this.logLines.shift();
  }

  /** The recent FTP command/response dialogue, or undefined if none captured. */
  diagnostics(): string | undefined {
    return this.logLines.length ? this.logLines.join("\n") : undefined;
  }

  private async loadClient(timeoutMs: number): Promise<FtpClientLike> {
    if (this.makeClient) return this.makeClient();
    const moduleName = "basic-ftp";
    const mod = (await import(moduleName)) as {
      Client?: new (timeout?: number) => FtpClientLike;
      enterPassiveModeIPv4?: unknown;
    };
    const Client = mod.Client;
    if (!Client) throw new Error("basic-ftp の読み込みに失敗しました。");
    // basic-ftp applies this timeout to the control and data sockets.
    const client = new Client(timeoutMs > 0 ? timeoutMs : 0);
    // Capture the protocol dialogue (PASV response, where it stalls, …) so a
    // failed connection can show the operator what actually happened. basic-ftp
    // masks the password in its own log output ("> PASS ###").
    const ctx = (client as unknown as { ftp?: { verbose?: boolean; log?: (m: string) => void } })
      .ftp;
    if (ctx) {
      ctx.verbose = true;
      ctx.log = (m: string) => this.pushLog(m);
    }
    // Force classic PASV (IPv4, NAT-aware) instead of basic-ftp's default,
    // which probes EPSV first. Shared hosts (e.g. Xserver) commonly leave the
    // EPSV data channel stalling until timeout; plain PASV with the control
    // host IP is the widely-used compatibility fix and avoids the hang.
    if (typeof mod.enterPassiveModeIPv4 === "function") {
      (client as unknown as { prepareTransfer: unknown }).prepareTransfer = mod.enterPassiveModeIPv4;
    }
    return client;
  }

  private async conn(): Promise<FtpClientLike> {
    if (this.client) return this.client;
    const timeoutMs = this.config.timeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const client = await this.loadClient(timeoutMs);
    const security = this.config.security ?? "ftps";
    // Hard upper bound on top of basic-ftp's own timeout: a stalled TLS
    // handshake or an unreachable passive data channel must not hang forever.
    await withTimeout(
      client.access({
        host: this.config.host,
        port: this.config.port ?? (security === "ftps-implicit" ? 990 : 21),
        user: this.config.username,
        password: this.config.password,
        secure: security === "ftp" ? false : security === "ftps-implicit" ? "implicit" : true,
      }),
      timeoutMs,
      "サーバーへの接続",
      () => client.close(),
    );
    const base = this.config.remoteDir || ".";
    if (base.startsWith("/")) {
      this.root = posix.normalize(base);
    } else {
      const pwd = await withTimeout(client.pwd(), timeoutMs, "サーバーへの接続", () =>
        client.close(),
      );
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
