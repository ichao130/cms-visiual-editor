import { describe, expect, it } from "vitest";
import { classifyZipEntry, inlineThemeAssets } from "../src/index.js";

describe("classifyZipEntry", () => {
  it("treats templates and pages as markup", () => {
    expect(classifyZipEntry("index.html")).toBe("markup");
    expect(classifyZipEntry("templates/page.htm")).toBe("markup");
    expect(classifyZipEntry("sections/hero.liquid")).toBe("markup");
    expect(classifyZipEntry("single.php")).toBe("markup");
    expect(classifyZipEntry("logo.svg")).toBe("markup");
  });

  it("recognizes image files", () => {
    for (const p of ["img/hero.png", "a.JPG", "b.jpeg", "c.gif", "d.webp", "e.avif"]) {
      expect(classifyZipEntry(p)).toBe("image");
    }
  });

  it("ignores scripts, other files, dirs and archive metadata", () => {
    expect(classifyZipEntry("assets/app.js")).toBe("ignore");
    expect(classifyZipEntry("fonts/x.woff2")).toBe("ignore");
    expect(classifyZipEntry("assets/")).toBe("ignore");
    expect(classifyZipEntry(".DS_Store")).toBe("ignore");
    expect(classifyZipEntry("theme/.gitignore")).toBe("ignore");
    expect(classifyZipEntry("__MACOSX/._index.html")).toBe("ignore");
  });

  it("handles backslash paths and query-free extension detection", () => {
    expect(classifyZipEntry("sections\\hero.html")).toBe("markup");
  });
});

describe("inlineThemeAssets", () => {
  const map = {
    "hero.jpg": "data:image/jpeg;base64,AAAA",
    "bg.png": "data:image/png;base64,BBBB",
    "retina.jpg": "data:image/jpeg;base64,CCCC",
  };

  it("inlines a matching <img> src by base name", () => {
    const r = inlineThemeAssets('<img src="assets/hero.jpg">', map);
    expect(r.html).toContain("data:image/jpeg;base64,AAAA");
    expect(r.html).not.toContain("assets/hero.jpg");
    expect(r.inlined).toBe(1);
    expect(r.missing).toEqual([]);
  });

  it("inlines each candidate in a srcset", () => {
    const r = inlineThemeAssets(
      '<img srcset="img/hero.jpg 1x, img/retina.jpg 2x">',
      map,
    );
    expect(r.html).toContain("data:image/jpeg;base64,AAAA 1x");
    expect(r.html).toContain("data:image/jpeg;base64,CCCC 2x");
    expect(r.inlined).toBe(2);
  });

  it("inlines url() in <style> and inline style", () => {
    const r = inlineThemeAssets(
      `<style>.h{background:url('assets/bg.png')}</style>` +
        `<div style="background:url(img/bg.png)"></div>`,
      map,
    );
    expect(r.html).toContain("data:image/png;base64,BBBB");
    expect(r.inlined).toBe(2);
  });

  it("leaves unmatched, external and data references untouched and records misses", () => {
    const r = inlineThemeAssets(
      '<img src="assets/unknown.jpg">' +
        '<img src="https://cdn.example.com/x.jpg">' +
        '<img src="data:image/gif;base64,ZZ">',
      map,
    );
    expect(r.html).toContain("assets/unknown.jpg");
    expect(r.html).toContain("https://cdn.example.com/x.jpg");
    expect(r.inlined).toBe(0);
    expect(r.missing).toEqual(["unknown.jpg"]);
  });
});
