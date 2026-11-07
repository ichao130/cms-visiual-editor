import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publish, LocalTransport, type Transport } from "../src/index.js";

let root: string;
let transport: LocalTransport;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pcms-deploy-"));
  transport = new LocalTransport(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("publish", () => {
  it("uploads everything on the first publish", async () => {
    const res = await publish(
      { "index.html": "<title>A</title>", "assets/x.css": "body{}" },
      transport,
    );
    expect(res.ok).toBe(true);
    expect(res.uploaded.sort()).toEqual(["assets/x.css", "index.html"]);
    expect(read("index.html")).toContain("<title>A</title>");
  });

  it("sends only changes and deletes removed files on a re-publish", async () => {
    const first = await publish(
      { "index.html": "v1", "old/index.html": "gone", "keep.txt": "k" },
      transport,
    );
    const res = await publish(
      { "index.html": "v2", "keep.txt": "k", "new.txt": "n" },
      transport,
      { previousManifest: first.manifest },
    );

    expect(res.uploaded.sort()).toEqual(["index.html", "new.txt"]);
    expect(res.deleted).toEqual(["old/index.html"]);
    expect(read("index.html")).toBe("v2");
    expect(existsSync(join(root, "old/index.html"))).toBe(false);
    expect(read("keep.txt")).toBe("k"); // untouched (not re-uploaded)
  });

  it("re-uploads everything when the destination is empty, even if the manifest says unchanged", async () => {
    // Publish once to record a manifest, then publish the SAME output to a fresh
    // empty destination (as when the remote directory is changed). The manifest
    // alone would say "nothing changed"; reconciling against the empty server
    // must force a full upload so the new directory isn't left incomplete.
    const first = await publish({ "index.html": "a", "assets/x.css": "b" }, transport);

    const rootB = mkdtempSync(join(tmpdir(), "pcms-deploy-b-"));
    try {
      const tB = new LocalTransport(rootB);
      const res = await publish(
        { "index.html": "a", "assets/x.css": "b" },
        tB,
        { previousManifest: first.manifest },
      );
      expect(res.uploaded.sort()).toEqual(["assets/x.css", "index.html"]);
      expect(readFileSync(join(rootB, "index.html"), "utf8")).toBe("a");
    } finally {
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("does not re-upload files already present on the server", async () => {
    const first = await publish({ "index.html": "a", "keep.txt": "k" }, transport);
    // Same output again; both files are still on the server → nothing to send.
    const res = await publish(
      { "index.html": "a", "keep.txt": "k" },
      transport,
      { previousManifest: first.manifest },
    );
    expect(res.uploaded).toEqual([]);
    expect(res.diff.unchanged.sort()).toEqual(["index.html", "keep.txt"]);
  });

  it("re-uploads only the file missing from the server", async () => {
    const first = await publish({ "index.html": "a", "keep.txt": "k" }, transport);
    // keep.txt vanishes from the server behind our back; manifest is unchanged.
    await transport.delete("keep.txt");
    const res = await publish(
      { "index.html": "a", "keep.txt": "k" },
      transport,
      { previousManifest: first.manifest },
    );
    expect(res.uploaded).toEqual(["keep.txt"]);
    expect(read("keep.txt")).toBe("k");
  });

  it("falls back to the manifest diff when the server listing fails", async () => {
    const first = await publish({ "index.html": "a", "keep.txt": "k" }, transport);
    // A transport whose listing throws must not break publishing: it just means
    // we cannot reconcile, so the manifest diff stands (here: nothing changed).
    const blindList: Transport = {
      put: (p, d) => transport.put(p, d),
      delete: (p) => transport.delete(p),
      get: (p) => transport.get(p),
      list: () => Promise.reject(new Error("listing unavailable")),
    };
    const res = await publish(
      { "index.html": "a", "keep.txt": "k" },
      blindList,
      { previousManifest: first.manifest },
    );
    expect(res.uploaded).toEqual([]);
  });

  it("computes a diff without sending on a dry run", async () => {
    const res = await publish({ "index.html": "x" }, transport, { dryRun: true });
    expect(res.diff.upload).toEqual(["index.html"]);
    expect(res.uploaded).toEqual([]);
    expect(existsSync(join(root, "index.html"))).toBe(false);
  });

  it("rolls back to the previous state when a transfer fails mid-publish", async () => {
    const first = await publish(
      { "a.txt": "1", "b.txt": "2" },
      transport,
    );

    // Fail while uploading the new file "c.txt", after "a.txt" is overwritten.
    const flaky: Transport = {
      put: (p, d) => {
        if (p === "c.txt") throw new Error("transfer failed");
        return transport.put(p, d);
      },
      delete: (p) => transport.delete(p),
      get: (p) => transport.get(p),
    };

    const res = await publish(
      { "a.txt": "1-changed", "c.txt": "3" }, // b.txt removed
      flaky,
      { previousManifest: first.manifest },
    );

    expect(res.ok).toBe(false);
    expect(res.rolledBack).toBe(true);
    // Previous state is restored: a.txt back to "1", b.txt still there, no c.txt.
    expect(read("a.txt")).toBe("1");
    expect(read("b.txt")).toBe("2");
    expect(existsSync(join(root, "c.txt"))).toBe(false);
  });
});

describe("LocalTransport.list", () => {
  it("lists every published file as a site-relative path", async () => {
    await publish({ "index.html": "a", "assets/style.css": "b", "blog/post.html": "c" }, transport);
    expect(await transport.list()).toEqual(["assets/style.css", "blog/post.html", "index.html"]);
  });

  it("returns an empty list for a directory that does not exist yet", async () => {
    const missing = new LocalTransport(join(root, "nope"));
    expect(await missing.list()).toEqual([]);
  });
});
