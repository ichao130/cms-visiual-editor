import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { Transport } from "../types.js";
import { toBytes } from "../hash.js";

/**
 * A filesystem transport: publishes into a local directory. Used as the "publish
 * to a folder" destination and as a stand-in for a server in tests. Paths are
 * confined to the root — traversal (`..`) is rejected.
 */
export class LocalTransport implements Transport {
  constructor(private readonly root: string) {}

  private full(path: string): string {
    const target = resolve(this.root, normalize(path));
    const base = resolve(this.root);
    if (target !== base && !target.startsWith(base + sep)) {
      throw new Error(`パスがルート外を指しています: ${path}`);
    }
    return target;
  }

  async put(path: string, data: string | Uint8Array): Promise<void> {
    const full = this.full(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, toBytes(data));
  }

  async delete(path: string): Promise<void> {
    await rm(this.full(path), { force: true });
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.full(path)));
    } catch {
      return null;
    }
  }

  // Exposed for callers that want the absolute path of an output file.
  pathOf(path: string): string {
    return join(this.root, path);
  }
}
