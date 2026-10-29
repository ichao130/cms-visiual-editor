import { describe, expect, it } from "vitest";
import { generateSite } from "../src/index.js";
import { sampleInput, sampleSettings, sampleSite, sampleTheme } from "./fixtures.js";

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

  it("orders a loop by the operator's manual order, overriding date", () => {
    // "old" has the newer date, so it would sort first by date. A manual order
    // puts "new" first instead.
    const content = [
      {
        type: "post",
        slug: "newer-date",
        fields: { title: "日付が新しい", date: "2026-02-10" },
        body: "<p>a</p>",
        order: 1,
      },
      {
        type: "post",
        slug: "older-date",
        fields: { title: "日付が古い", date: "2026-02-01" },
        body: "<p>b</p>",
        order: 0,
      },
    ];
    const home = generateSite({
      site: sampleSite(),
      settings: sampleSettings(),
      contentTypes: [],
      content,
      theme: sampleTheme(),
    }).files["index.html"]!;
    // The order:0 item ("日付が古い") appears before the order:1 item.
    expect(home.indexOf("日付が古い")).toBeLessThan(home.indexOf("日付が新しい"));

    // Without a manual order, the newer date wins.
    const byDate = generateSite({
      site: sampleSite(),
      settings: sampleSettings(),
      contentTypes: [],
      content: content.map(({ order: _order, ...rest }) => rest),
      theme: sampleTheme(),
    }).files["index.html"]!;
    expect(byDate.indexOf("日付が新しい")).toBeLessThan(byDate.indexOf("日付が古い"));
  });

  it("emits a rich RSS feed with description, pubDate, guid and categories", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: { pages: {} },
      contentTypes: [],
      content: [
        {
          type: "post",
          slug: "news",
          fields: {
            title: "お知らせ記事",
            date: "2026-02-01",
            description: "記事の要約です。",
            category: ["お知らせ"],
          },
          body: "<p>本文</p>",
        },
      ],
      taxonomies: [{ name: "category", label: "カテゴリ", types: ["post"] }],
      theme: sampleTheme(),
    });
    const feed = out.files["feed.xml"]!;
    // Channel metadata.
    expect(feed).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
    expect(feed).toContain("<description>駅前の小さな自家焙煎珈琲店です。</description>");
    expect(feed).toContain("<language>ja</language>");
    expect(feed).toContain(
      '<atom:link href="https://example.test/feed.xml" rel="self" type="application/rss+xml"/>',
    );
    expect(feed).toContain("<lastBuildDate>Sun, 01 Feb 2026 00:00:00 GMT</lastBuildDate>");
    // Item fields.
    expect(feed).toContain("<description>記事の要約です。</description>");
    expect(feed).toContain("<pubDate>Sun, 01 Feb 2026 00:00:00 GMT</pubDate>");
    expect(feed).toContain(
      '<guid isPermaLink="true">https://example.test/post/news/</guid>',
    );
    expect(feed).toContain("<category>お知らせ</category>");
  });

  it("marks a noindex item with a robots meta and keeps it out of sitemap/feed", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: { pages: {} },
      contentTypes: [],
      content: [
        { type: "post", slug: "shown", fields: { title: "通常記事" }, body: "<p>a</p>" },
        {
          type: "post",
          slug: "hidden",
          fields: { title: "非公開記事" },
          body: "<p>b</p>",
          noindex: true,
        },
      ],
      theme: sampleTheme(),
    });
    // The page is still generated...
    const hidden = out.files["post/hidden/index.html"]!;
    expect(hidden).toBeDefined();
    expect(hidden.split("</head>")[0]).toContain(
      '<meta name="robots" content="noindex, follow">',
    );
    // ...but kept out of the sitemap and the feed.
    expect(out.files["sitemap.xml"]).not.toContain("/post/hidden/");
    expect(out.files["sitemap.xml"]).toContain("/post/shown/");
    expect(out.files["feed.xml"]).not.toContain("非公開記事");
    expect(out.files["feed.xml"]).toContain("通常記事");
    // An indexed page carries no robots meta.
    expect(out.files["post/shown/index.html"]).not.toContain('name="robots"');
  });
});
