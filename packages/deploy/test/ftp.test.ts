import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { FtpTransport, type FtpClientLike } from "../src/index.js";

/** An in-memory fake of the `basic-ftp` surface FtpTransport uses. */
class FakeFtp implements FtpClientLike {
  readonly files = new Map<string, Buffer>();
  readonly dirs = new Set<string>();
  readonly access_: Record<string, unknown>[] = [];
  closed = false;
  loginDir = "/home/site";

  async access(opts: Record<string, unknown>) {
    this.access_.push(opts);
  }
  async pwd() {
    return this.loginDir;
  }
  async ensureDir(dir: string) {
    this.dirs.add(dir);
  }
  async uploadFrom(source: Readable, to: string) {
    const chunks: Buffer[] = [];
    for await (const c of source) chunks.push(Buffer.from(c as Buffer));
    this.files.set(to, Buffer.concat(chunks));
  }
  async remove(path: string) {
    if (!this.files.has(path)) {
      const err = new Error("550 No such file") as Error & { code: number };
      err.code = 550;
      throw err;
    }
    this.files.delete(path);
  }
  async downloadTo(dest: Writable, from: string) {
    const data = this.files.get(from);
    if (!data) {
      const err = new Error("550 No such file") as Error & { code: number };
      err.code = 550;
      throw err;
    }
    await new Promise<void>((res, rej) => dest.end(data, (e?: Error | null) => (e ? rej(e) : res())));
  }
  async list(path = "/") {
    const base = path.endsWith("/") ? path : path + "/";
    const children = new Map<string, boolean>(); // name → isDirectory
    for (const key of this.files.keys()) {
      if (!key.startsWith(base)) continue;
      const rest = key.slice(base.length);
      const slash = rest.indexOf("/");
      if (slash === -1) children.set(rest, false);
      else children.set(rest.slice(0, slash), true);
    }
    return [...children].map(([name, isDirectory]) => ({ name, isDirectory }));
  }
  close() {
    this.closed = true;
  }
}

function make(config: Partial<ConstructorParameters<typeof FtpTransport>[0]> = {}) {
  const fake = new FakeFtp();
  const t = new FtpTransport(
    { host: "h", username: "u", password: "p", remoteDir: "public_html", ...config },
    async () => fake,
  );
  return { fake, t };
}

describe("FtpTransport", () => {
  it("resolves relative remoteDir against the login directory and uploads there", async () => {
    const { fake, t } = make();
    await t.put("index.html", "<title>A</title>");
    expect([...fake.files.keys()]).toEqual(["/home/site/public_html/index.html"]);
    expect(fake.files.get("/home/site/public_html/index.html")!.toString()).toBe("<title>A</title>");
    expect(fake.dirs.has("/home/site/public_html")).toBe(true);
  });

  it("keeps an absolute remoteDir as given", async () => {
    const { fake, t } = make({ remoteDir: "/var/www/html" });
    await t.put("a/b.css", "body{}");
    expect(fake.files.has("/var/www/html/a/b.css")).toBe(true);
    expect(fake.dirs.has("/var/www/html/a")).toBe(true);
  });

  it("creates each parent directory only once", async () => {
    const { fake, t } = make();
    let calls = 0;
    const orig = fake.ensureDir.bind(fake);
    fake.ensureDir = async (d: string) => {
      calls++;
      return orig(d);
    };
    await t.put("assets/x.css", "1");
    await t.put("assets/y.css", "2");
    expect(calls).toBe(1); // same dir, ensured once
  });

  it("round-trips through get, and returns null for a missing file", async () => {
    const { t } = make();
    await t.put("data.json", '{"k":1}');
    const got = await t.get("data.json");
    expect(new TextDecoder().decode(got!)).toBe('{"k":1}');
    expect(await t.get("missing.txt")).toBeNull();
  });

  it("ignores a 550 on delete (already gone)", async () => {
    const { fake, t } = make();
    await t.put("gone.html", "x");
    await t.delete("gone.html");
    expect(fake.files.has("/home/site/public_html/gone.html")).toBe(false);
    await expect(t.delete("never-existed.html")).resolves.toBeUndefined();
  });

  it("selects the security mode and default port", async () => {
    const plain = make({ security: "ftp" });
    await plain.t.put("a", "1");
    expect(plain.fake.access_[0]).toMatchObject({ secure: false, port: 21 });

    const explicit = make({ security: "ftps" });
    await explicit.t.put("a", "1");
    expect(explicit.fake.access_[0]).toMatchObject({ secure: true, port: 21 });

    const implicit = make({ security: "ftps-implicit" });
    await implicit.t.put("a", "1");
    expect(implicit.fake.access_[0]).toMatchObject({ secure: "implicit", port: 990 });
  });

  it("lists existing files under the remote root as site-relative paths", async () => {
    const { t } = make();
    await t.put("index.html", "a");
    await t.put("assets/style.css", "b");
    await t.put("blog/post.html", "c");
    expect(await t.list()).toEqual(["assets/style.css", "blog/post.html", "index.html"]);
  });

  it("closes the underlying client", async () => {
    const { fake, t } = make();
    await t.put("a", "1");
    await t.close();
    expect(fake.closed).toBe(true);
  });
});
