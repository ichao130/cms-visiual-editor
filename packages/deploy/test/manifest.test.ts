import { describe, expect, it } from "vitest";
import { manifestOf, diffManifests } from "../src/index.js";

describe("manifestOf + diffManifests", () => {
  it("fingerprints files and detects changes", () => {
    const prev = manifestOf({ "a.html": "<h1>A</h1>", "b.css": "x" });
    const next = manifestOf({
      "a.html": "<h1>A changed</h1>", // changed
      "c.js": "new", // new
      "b.css": "x", // unchanged
    });

    const diff = diffManifests(prev, next);
    expect(diff.upload).toEqual(["a.html", "c.js"]);
    expect(diff.delete).toEqual([]);
    expect(diff.unchanged).toEqual(["b.css"]);
  });

  it("deletes files that are gone, scoped to the previous manifest", () => {
    const prev = manifestOf({ "old/index.html": "x", "keep.txt": "y" });
    const next = manifestOf({ "keep.txt": "y" });
    const diff = diffManifests(prev, next);
    expect(diff.delete).toEqual(["old/index.html"]);
    expect(diff.upload).toEqual([]);
  });

  it("treats an absent previous manifest as a full upload", () => {
    const next = manifestOf({ "index.html": "x" });
    const diff = diffManifests(undefined, next);
    expect(diff.upload).toEqual(["index.html"]);
    expect(diff.delete).toEqual([]);
  });
});
