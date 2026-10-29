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
});
