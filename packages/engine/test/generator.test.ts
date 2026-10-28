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

  it("emits OGP defaults and verification tags in every page head", () => {
    for (const [path, html] of Object.entries(files)) {
      if (!path.endsWith(".html") || path === "404.html") continue;
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head, path).toContain('<meta property="og:site_name" content="テスト珈琲店">');
      expect(head, path).toContain('<meta property="og:type" content="website">');
      expect(head, path).toContain(
        '<meta property="og:description" content="駅前の小さな自家焙煎珈琲店です。">',
      );
      expect(head, path).toContain(
        '<meta property="og:image" content="https://example.test/media/sample-beans.svg">',
      );
      expect(head, path).toContain(
        '<meta name="google-site-verification" content="test-google-token">',
      );
      expect(head, path).toContain(
        '<meta name="description" content="駅前の小さな自家焙煎珈琲店です。">',
      );
      // The sample site has an OGP image, so the large-image card is used.
      expect(head, path).toContain('<meta name="twitter:card" content="summary_large_image">');
    }
  });

  it("emits a canonical URL (and og:url) matching each page's own path", () => {
    const expectCanonical = (path: string, url: string) => {
      const head = files[path]!.slice(0, files[path]!.indexOf("</head>"));
      expect(head, path).toContain(`<link rel="canonical" href="${url}">`);
      expect(head, path).toContain(`<meta property="og:url" content="${url}">`);
    };
    expectCanonical("index.html", "https://example.test/");
    expectCanonical("post/open/index.html", "https://example.test/post/open/");
    expectCanonical("page/about/index.html", "https://example.test/page/about/");
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
