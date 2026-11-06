import { describe, expect, it } from "vitest";
import { S3Transport, contentTypeFor, type S3ObjectStore } from "../src/index.js";

/** An in-memory fake of the object store S3Transport drives. */
class FakeStore implements S3ObjectStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType?: string }>();
  closed = false;

  async putObject({ key, body, contentType }: { key: string; body: Uint8Array; contentType?: string }) {
    this.objects.set(key, { body, contentType });
  }
  async deleteObject({ key }: { key: string }) {
    this.objects.delete(key); // idempotent, like S3
  }
  async getObject({ key }: { key: string }) {
    return this.objects.get(key)?.body ?? null;
  }
  async listObjects({ prefix }: { prefix: string }) {
    const base = prefix ? prefix + "/" : "";
    return [...this.objects.keys()].filter((k) => k.startsWith(base));
  }
  close() {
    this.closed = true;
  }
}

function make(config: Partial<ConstructorParameters<typeof S3Transport>[0]> = {}) {
  const fake = new FakeStore();
  const t = new S3Transport(
    { bucket: "my-bucket", region: "ap-northeast-1", accessKeyId: "AK", secretAccessKey: "SK", ...config },
    async () => fake,
  );
  return { fake, t };
}

describe("S3Transport", () => {
  it("writes each file as an object keyed by its path, with a content type", async () => {
    const { fake, t } = make();
    await t.put("index.html", "<title>A</title>");
    const obj = fake.objects.get("index.html")!;
    expect(new TextDecoder().decode(obj.body)).toBe("<title>A</title>");
    expect(obj.contentType).toBe("text/html; charset=utf-8");
  });

  it("places objects under the prefix, with no leading slash", async () => {
    const { fake, t } = make({ prefix: "/sites/cafe/" });
    await t.put("/assets/app.css", "body{}");
    expect([...fake.objects.keys()]).toEqual(["sites/cafe/assets/app.css"]);
    expect(fake.objects.get("sites/cafe/assets/app.css")!.contentType).toBe("text/css; charset=utf-8");
  });

  it("round-trips through get and returns null for a missing key", async () => {
    const { t } = make();
    await t.put("data.json", '{"k":1}');
    expect(new TextDecoder().decode((await t.get("data.json"))!)).toBe('{"k":1}');
    expect(await t.get("missing.txt")).toBeNull();
  });

  it("deletes a key and tolerates deleting a missing one", async () => {
    const { fake, t } = make();
    await t.put("gone.html", "x");
    await t.delete("gone.html");
    expect(fake.objects.has("gone.html")).toBe(false);
    await expect(t.delete("never.html")).resolves.toBeUndefined();
  });

  it("lists objects under the prefix as site-relative paths", async () => {
    const { t } = make({ prefix: "sites/cafe" });
    await t.put("index.html", "a");
    await t.put("assets/app.css", "b");
    expect(await t.list()).toEqual(["assets/app.css", "index.html"]);
  });

  it("lists objects at the bucket root when there is no prefix", async () => {
    const { t } = make();
    await t.put("index.html", "a");
    await t.put("blog/post.html", "b");
    expect(await t.list()).toEqual(["blog/post.html", "index.html"]);
  });

  it("closes the underlying store", async () => {
    const { fake, t } = make();
    await t.put("a", "1");
    await t.close();
    expect(fake.closed).toBe(true);
  });
});

describe("contentTypeFor", () => {
  it("maps common web extensions and defaults to octet-stream", () => {
    expect(contentTypeFor("a/b/page.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("sitemap.xml")).toBe("application/xml; charset=utf-8");
    expect(contentTypeFor("logo.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("photo.WEBP")).toBe("image/webp");
    expect(contentTypeFor("data.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("noext")).toBe("application/octet-stream");
  });
});
