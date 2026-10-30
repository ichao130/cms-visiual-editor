import { describe, expect, it } from "vitest";
import { preflight } from "../src/index.js";

const ok = {
  "index.html": '<html><head><title>Home</title></head><body><a href="/about/">about</a></body></html>',
  "about/index.html": "<html><head><title>About</title></head><body>hi</body></html>",
  "sitemap.xml": "<urlset/>",
  "robots.txt": "User-agent: *",
  "404.html": "<title>404</title>",
};

describe("preflight", () => {
  it("passes a well-formed site with no errors", () => {
    const issues = preflight(ok);
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("flags missing required files", () => {
    const rest: Record<string, string> = { ...ok };
    delete rest["sitemap.xml"];
    const issues = preflight(rest);
    expect(issues.some((i) => i.level === "error" && i.path === "sitemap.xml")).toBe(true);
  });

  it("warns on a missing title and a broken internal link", () => {
    const issues = preflight({
      ...ok,
      "bad/index.html": '<html><body><a href="/nowhere/">x</a></body></html>',
    });
    expect(issues.some((i) => i.message.includes("タイトル") && i.path === "bad/index.html")).toBe(true);
    expect(issues.some((i) => i.message.includes("リンク先") && i.message.includes("/nowhere/"))).toBe(true);
  });

  it("errors on an empty HTML page", () => {
    const issues = preflight({ ...ok, "empty.html": "" });
    expect(issues.some((i) => i.level === "error" && i.path === "empty.html")).toBe(true);
  });

  it("warns on images with no alt attribute but not on decorative alt=\"\"", () => {
    const issues = preflight({
      ...ok,
      "pics/index.html":
        '<html><head><title>P</title></head><body><img src="a.jpg"><img src="b.jpg" alt=""><img src="c.jpg"></body></html>',
    });
    const alt = issues.find((i) => i.message.includes("alt") && i.path === "pics/index.html");
    expect(alt).toBeDefined();
    // Two images miss alt; the alt="" one is decorative and not counted.
    expect(alt?.message).toContain("2個");
    // A page where every image has alt text is not flagged.
    expect(issues.some((i) => i.message.includes("alt") && i.path === "index.html")).toBe(false);
  });

  it("warns on a missing meta description", () => {
    const issues = preflight({
      ...ok,
      "d/index.html":
        '<html><head><title>D</title><meta name="description" content="説明"><h1>見出し</h1></head><body>x</body></html>',
      "nd/index.html":
        "<html><head><title>ND</title></head><body><h1>見出し</h1></body></html>",
    });
    expect(issues.some((i) => i.message.includes("メタディスクリプション") && i.path === "nd/index.html")).toBe(true);
    expect(issues.some((i) => i.message.includes("メタディスクリプション") && i.path === "d/index.html")).toBe(false);
  });

  it("warns on zero or multiple h1 headings", () => {
    const issues = preflight({
      ...ok,
      "none/index.html": "<html><head><title>N</title></head><body><p>本文</p></body></html>",
      "many/index.html":
        "<html><head><title>M</title></head><body><h1>A</h1><h1>B</h1></body></html>",
    });
    expect(issues.some((i) => i.message.includes("見出し(h1)がありません") && i.path === "none/index.html")).toBe(true);
    expect(issues.some((i) => i.message.includes("見出し(h1)が2個") && i.path === "many/index.html")).toBe(true);
  });

  it("warns when two pages share the same title", () => {
    const issues = preflight({
      ...ok,
      "a/index.html": "<html><head><title>同じ</title></head><body><h1>a</h1></body></html>",
      "b/index.html": "<html><head><title>同じ</title></head><body><h1>b</h1></body></html>",
    });
    const dupes = issues.filter((i) => i.message.includes("重複"));
    expect(dupes.map((i) => i.path).sort()).toEqual(["a/index.html", "b/index.html"]);
    // The unique titles in the base set are not flagged.
    expect(issues.some((i) => i.message.includes("重複") && i.path === "index.html")).toBe(false);
  });
});
