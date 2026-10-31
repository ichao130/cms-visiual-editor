import { describe, expect, it } from "vitest";
import { hashString, manifestOf, publishDiff } from "../src/api/publishDiff.js";

describe("publishDiff", () => {
  it("uploads everything on a first publish (no previous manifest)", () => {
    const next = manifestOf({ "index.html": "<p>a</p>", "post/x/index.html": "<p>b</p>" });
    const diff = publishDiff(null, next);
    expect(diff.upload).toEqual(["index.html", "post/x/index.html"]);
    expect(diff.delete).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it("separates changed, unchanged, new and deleted paths", () => {
    const prev = manifestOf({
      "index.html": "<p>a</p>",
      "post/old/index.html": "<p>old</p>",
      "feed.xml": "<rss/>",
    });
    const next = manifestOf({
      "index.html": "<p>a-edited</p>", // changed
      "feed.xml": "<rss/>", // unchanged
      "post/new/index.html": "<p>new</p>", // new
      // post/old/index.html is gone → delete
    });
    const diff = publishDiff(prev, next);
    expect(diff.upload).toEqual(["index.html", "post/new/index.html"]);
    expect(diff.delete).toEqual(["post/old/index.html"]);
    expect(diff.unchanged).toEqual(["feed.xml"]);
  });

  it("reports no changes when the manifest is identical", () => {
    const files = { "index.html": "<p>a</p>", "feed.xml": "<rss/>" };
    const m = manifestOf(files);
    const diff = publishDiff(m, manifestOf(files));
    expect(diff.upload).toEqual([]);
    expect(diff.delete).toEqual([]);
    expect(diff.unchanged).toEqual(["feed.xml", "index.html"]);
  });

  it("hashes differ for different content and match for identical", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
