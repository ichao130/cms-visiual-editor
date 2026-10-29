import { describe, expect, it } from "vitest";
import { generateSite } from "../src/index.js";
import { sampleInput, sampleSite, sampleTheme } from "./fixtures.js";

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

  it("marks content item pages as og:type=article, other pages as website", () => {
    const head = (p: string) => files[p]!.slice(0, files[p]!.indexOf("</head>"));
    expect(head("post/open/index.html")).toContain('<meta property="og:type" content="article">');
    expect(head("page/about/index.html")).toContain('<meta property="og:type" content="article">');
    expect(head("index.html")).toContain('<meta property="og:type" content="website">');
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

  it("excludes draft items from pages, the feed and the sitemap", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: { pages: {} },
      contentTypes: [],
      content: [
        { type: "post", slug: "live", fields: { title: "公開記事" }, body: "<p>a</p>" },
        {
          type: "post",
          slug: "wip",
          fields: { title: "下書き記事" },
          body: "<p>b</p>",
          status: "draft",
        },
      ],
      theme: sampleTheme(),
    });
    expect(out.files["post/live/index.html"]).toBeDefined();
    expect(out.files["post/wip/index.html"]).toBeUndefined();
    expect(out.files["sitemap.xml"]).not.toContain("/post/wip/");
    expect(out.files["feed.xml"]).not.toContain("下書き記事");
    expect(out.files["feed.xml"]).toContain("公開記事");
  });

  it("overrides the description with a content item's own on its page only", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: { pages: {} },
      contentTypes: [],
      content: [
        {
          type: "post",
          slug: "seo",
          fields: { title: "SEO記事", description: "この記事だけの説明文。" },
          body: "<p>本文</p>",
        },
        { type: "post", slug: "plain", fields: { title: "説明なし" }, body: "<p>本文</p>" },
      ],
      theme: sampleTheme(),
    });
    const itemHead = out.files["post/seo/index.html"]!.split("</head>")[0]!;
    expect(itemHead).toContain('<meta name="description" content="この記事だけの説明文。">');
    expect(itemHead).toContain('<meta property="og:description" content="この記事だけの説明文。">');
    // The page-level description replaces the site default, not duplicates it.
    expect(itemHead).not.toContain("駅前の小さな自家焙煎珈琲店です。");
    // A page without its own description keeps the site default.
    const plainHead = out.files["post/plain/index.html"]!.split("</head>")[0]!;
    expect(plainHead).toContain('<meta name="description" content="駅前の小さな自家焙煎珈琲店です。">');
  });
});
