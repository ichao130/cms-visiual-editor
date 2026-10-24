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
