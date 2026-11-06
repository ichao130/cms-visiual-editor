import { posix } from "node:path";
import type { DirListing, SftpConfig, Transport } from "../types.js";
import { toBytes } from "../hash.js";
import { withTimeout, DEFAULT_CONNECT_TIMEOUT_MS } from "../timeout.js";
import { ListingBudget, MAX_LISTING_ENTRIES } from "../listing.js";
import { parentOf, sortDirEntries } from "./browse.js";

/** Minimal surface of ssh2-sftp-client that we use (loaded dynamically). */
interface SftpClient {
  connect(opts: Record<string, unknown>): Promise<unknown>;
  put(input: Buffer, remote: string): Promise<string>;
  delete(remote: string, noErrorOK?: boolean): Promise<string>;
  get(remote: string): Promise<Buffer>;
  mkdir(remote: string, recursive?: boolean): Promise<string>;
  exists(remote: string): Promise<false | "d" | "-" | "l">;
  list(remote: string): Promise<Array<{ type: string; name: string }>>;
  /** Resolve a (possibly relative) path to an absolute one; "" if missing. */
  realPath(remote: string): Promise<string>;
  /** The remote working (home) directory. */
  cwd(): Promise<string>;
  end(): Promise<void>;
}

/**
 * SFTP transport. `ssh2-sftp-client` is imported dynamically so the deploy core
 * stays dependency-free and testable; the desktop app provides the module.
 * Connection details come from the caller (never stored in the cloud).
 */
export class SftpTransport implements Transport {
  private client: SftpClient | null = null;
  private readonly ensured = new Set<string>();
  /** Budget of the most recent list(), to report truncation. */
  private budget: ListingBudget | null = null;

  constructor(private readonly config: SftpConfig) {}

  private remote(path: string): string {
    return posix.join(this.config.remoteDir, path);
  }

  private async conn(): Promise<SftpClient> {
    if (this.client) return this.client;
    const moduleName = "ssh2-sftp-client";
    const mod = await import(moduleName);
    const Client = (mod.default ?? mod) as new () => SftpClient;
    const client = new Client();
    const timeoutMs = this.config.timeoutMillis ?? DEFAULT_CONNECT_TIMEOUT_MS;
    // readyTimeout bounds the handshake inside ssh2; withTimeout is a hard
    // upper bound in case the TCP connect itself stalls (dropped packets).
    await withTimeout(
      client.connect({
        host: this.config.host,
        port: this.config.port ?? 22,
        username: this.config.username,
        password: this.config.password,
        privateKey: this.config.privateKey,
        ...(timeoutMs > 0 ? { readyTimeout: timeoutMs } : {}),
      }),
      timeoutMs,
      "サーバーへの接続",
      () => {
        void client.end();
      },
    );
    this.client = client;
    return client;
  }

  private async ensureDir(remoteFile: string): Promise<void> {
    const dir = posix.dirname(remoteFile);
    if (this.ensured.has(dir)) return;
    const client = await this.conn();
    if (!(await client.exists(dir))) await client.mkdir(dir, true);
    this.ensured.add(dir);
  }

  async put(path: string, data: string | Uint8Array): Promise<void> {
    const client = await this.conn();
    const remote = this.remote(path);
    await this.ensureDir(remote);
    await client.put(Buffer.from(toBytes(data)), remote);
  }

  async delete(path: string): Promise<void> {
    const client = await this.conn();
    await client.delete(this.remote(path), true);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const client = await this.conn();
    const remote = this.remote(path);
    if (!(await client.exists(remote))) return null;
    return new Uint8Array(await client.get(remote));
  }

  async list(): Promise<string[]> {
    const client = await this.conn();
    const out: string[] = [];
    this.budget = new ListingBudget();
    await this.walk(client, this.config.remoteDir || ".", "", out, 0, this.budget);
    return out.sort();
  }

  /** Whether the last list() was cut short by a size/depth/time limit. */
  listTruncated(): boolean {
    return this.budget?.truncated ?? false;
  }

  /**
   * List one directory level so the operator can browse the server and pick the
   * publish folder. `path === ""` starts at the login (home) directory.
   * Navigation is by absolute path and ignores the configured remoteDir.
   */
  async browse(path: string): Promise<DirListing> {
    const client = await this.conn();
    const want = path.trim();
    let dir = want ? await client.realPath(want) : await client.cwd();
    if (!dir) dir = want || "/";
    dir = posix.normalize(dir);
    const raw = await client.list(dir);
    const truncated = raw.length > MAX_LISTING_ENTRIES;
    const entries = sortDirEntries(
      raw
        .filter((e) => e.name !== "." && e.name !== "..")
        .slice(0, MAX_LISTING_ENTRIES)
        .map((e) => ({ name: e.name, isDirectory: e.type === "d" })),
    );
    return { path: dir, parent: parentOf(dir), entries, ...(truncated ? { truncated } : {}) };
  }

  private async walk(
    client: SftpClient,
    remoteDir: string,
    rel: string,
    out: string[],
    depth: number,
    budget: ListingBudget,
  ): Promise<void> {
    if (budget.spent(out.length) || budget.tooDeep(depth)) return;
    let entries: Array<{ type: string; name: string }>;
    try {
      entries = await client.list(remoteDir);
    } catch {
      return; // missing / unreadable directory → nothing to list there
    }
    for (const entry of entries) {
      if (budget.spent(out.length)) return;
      if (entry.name === "." || entry.name === "..") continue;
      const childRel = rel ? posix.join(rel, entry.name) : entry.name;
      if (entry.type === "d") {
        await this.walk(client, posix.join(remoteDir, entry.name), childRel, out, depth + 1, budget);
      } else {
        out.push(childRel);
      }
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}
