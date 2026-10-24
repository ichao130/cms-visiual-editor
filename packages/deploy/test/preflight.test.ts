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
});
