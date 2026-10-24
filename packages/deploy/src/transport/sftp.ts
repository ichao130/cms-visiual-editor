import { posix } from "node:path";
import type { SftpConfig, Transport } from "../types.js";
import { toBytes } from "../hash.js";

/** Minimal surface of ssh2-sftp-client that we use (loaded dynamically). */
interface SftpClient {
  connect(opts: Record<string, unknown>): Promise<unknown>;
  put(input: Buffer, remote: string): Promise<string>;
  delete(remote: string, noErrorOK?: boolean): Promise<string>;
  get(remote: string): Promise<Buffer>;
  mkdir(remote: string, recursive?: boolean): Promise<string>;
  exists(remote: string): Promise<false | "d" | "-" | "l">;
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
    await client.connect({
      host: this.config.host,
      port: this.config.port ?? 22,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKey,
    });
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

  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
    }
  }
}
