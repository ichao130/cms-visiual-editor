import { describe, expect, it } from "vitest";
import { generateSite } from "../src/index.js";
import { sampleInput } from "./fixtures.js";

describe("generateSite", () => {
  const { files, assets } = generateSite(sampleInput());

  it("emits a page for the home page and every content item", () => {
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "index.html",
        "post/open/index.html",
        "post/hours/index.html",
        "page/about/index.html",
      ]),
    );
  });

  it("always emits sitemap, robots, feed and 404", () => {
    expect(files["sitemap.xml"]).toContain("<urlset");
    expect(files["sitemap.xml"]).toContain("https://example.test/post/open/");
    expect(files["robots.txt"]).toContain("Sitemap: https://example.test/sitemap.xml");
    expect(files["feed.xml"]).toContain("開店しました");
    expect(files["404.html"]).toContain("404");
  });

  it("renders HTML content bodies into item pages", () => {
    const post = files["post/open/index.html"]!;
    expect(post).toContain("<h2>ごあいさつ</h2>");
    expect(post).toContain("<strong>開店</strong>");
    expect(post).toContain("開店しました"); // title bound
  });

  it("lists theme assets to copy", () => {
    expect(assets).toEqual(["assets/style.css"]);
  });

  it("produces clean HTML with no leftover editor attributes", () => {
    for (const [path, html] of Object.entries(files)) {
      if (!path.endsWith(".html")) continue;
      expect(html, path).not.toMatch(/data-(section|field|type|label|loop|repeat|slot)=/);
    }
  });

  it("matches the home page snapshot", () => {
    expect(files["index.html"]).toMatchSnapshot();
  });
});
