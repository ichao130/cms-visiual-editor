import { describe, expect, it } from "vitest";
import type { MediaItem } from "@pcms/shared";
import { formatBytes, mediaMeta, unusedMedia } from "../src/components/MediaLibrary.js";

describe("formatBytes", () => {
  it("shows bytes under 1 KiB", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("rounds to KB under 1 MiB", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536)).toBe("2 KB"); // rounds
  });
  it("shows one decimal of MB at or above 1 MiB", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});

describe("mediaMeta", () => {
  const base: MediaItem = { id: "x", fileName: "x.webp", path: "media/x.webp" };

  it("joins dimensions and size", () => {
    expect(mediaMeta({ ...base, width: 320, height: 200, size: 2048 })).toBe("320×200・2 KB");
  });
  it("omits dimensions when they are unknown", () => {
    expect(mediaMeta({ ...base, size: 2048 })).toBe("2 KB");
  });
  it("omits size when it is unknown", () => {
    expect(mediaMeta({ ...base, width: 320, height: 200 })).toBe("320×200");
  });
  it("is empty when nothing is known", () => {
    expect(mediaMeta(base)).toBe("");
  });
});

describe("unusedMedia", () => {
  const a: MediaItem = { id: "a", fileName: "a.webp", path: "media/a.webp" };
  const b: MediaItem = { id: "b", fileName: "b.webp", path: "media/b.webp" };
  const c: MediaItem = { id: "c", fileName: "c.webp", path: "media/c.webp" };

  it("returns only items with a zero usage count", () => {
    const usage = { "media/a.webp": 2, "media/b.webp": 0, "media/c.webp": 0 };
    expect(unusedMedia([a, b, c], usage).map((m) => m.path)).toEqual([
      "media/b.webp",
      "media/c.webp",
    ]);
  });

  it("treats a missing usage entry as unused", () => {
    expect(unusedMedia([a], {}).map((m) => m.path)).toEqual(["media/a.webp"]);
  });

  it("returns nothing when every item is used", () => {
    expect(unusedMedia([a, b], { "media/a.webp": 1, "media/b.webp": 3 })).toEqual([]);
  });
});
