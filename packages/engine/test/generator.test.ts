import { describe, expect, it } from "vitest";
import { generateSite, preflight } from "../src/index.js";
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
    // The 404 page carries a meta description (so pre-publish SEO checks pass)
    // and is marked noindex.
    expect(files["404.html"]).toContain('<meta name="description"');
    expect(files["404.html"]).toContain('<meta name="robots" content="noindex">');
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

  it("gives the home page the site name and other pages a '| site name' title", () => {
    expect(files["index.html"]).toContain("<title>テスト珈琲店</title>");
    expect(files["post/open/index.html"]).toContain("<title>開店しました | テスト珈琲店</title>");
    expect(files["page/about/index.html"]).toContain("<title>お店について | テスト珈琲店</title>");
  });

  it("gives every page a unique <title> (no duplicate-title SEO warnings)", () => {
    const titles: string[] = [];
    for (const [path, html] of Object.entries(files)) {
      if (!path.endsWith(".html")) continue;
      const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
      if (m) titles.push(m[1]!);
    }
    expect(titles.length).toBeGreaterThan(1);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("derives a meta description from main content when none is set anywhere", () => {
    const out = generateSite({
      site: { name: "説明なしサイト", baseUrl: "https://example.test" },
      settings: { pages: {} },
      contentTypes: [],
      content: [
        {
          type: "post",
          slug: "p",
          fields: { title: "記事" },
          body: "<p>これは本文から自動生成される説明文です。</p>",
        },
      ],
      theme: {
        config: {},
        // Nav/footer text must stay out of the description; only <main> counts.
        layout:
          '<html><head><title data-field="site.name"></title></head><body><nav>メニュー 会社情報</nav><main data-slot="content"></main><footer>フッター表記</footer></body></html>',
        templates: { post: '<div data-field="post.body" data-type="richtext"></div>' },
      },
    });
    const head = out.files["post/p/index.html"]!.split("</head>")[0]!;
    expect(head).toContain(
      '<meta name="description" content="これは本文から自動生成される説明文です。">',
    );
    expect(head).not.toContain("メニュー");
    expect(head).not.toContain("フッター表記");
  });

  it("numbers paginated archive titles past the first page", () => {
    const content = Array.from({ length: 4 }, (_, i) => ({
      type: "post",
      slug: `n${i}`,
      fields: { title: `記事${i}`, date: `2026-02-0${i + 1}` },
      body: "<p>x</p>",
    }));
    const out = generateSite({
      site: { name: "テスト珈琲店", baseUrl: "https://example.test", archivePageSize: 2 },
      settings: { pages: {} },
      contentTypes: [{ name: "post", label: "記事", fields: [] }],
      content,
      theme: {
        config: {},
        layout: '<html><head><title data-field="site.name"></title></head><body><main data-slot="content"></main></body></html>',
        templates: {
          post: "<article data-field=\"post.title\"></article>",
          archive: '<ul><li data-loop="items"><span data-field="item.title"></span></li></ul>',
        },
      },
    });
    const p1 = out.files["post/index.html"]!;
    const p2 = out.files["post/page/2/index.html"]!;
    expect(p1).toContain("<title>記事 | テスト珈琲店</title>");
    expect(p2).toContain("<title>記事（2ページ目） | テスト珈琲店</title>");
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

  it("injects the GA4 gtag snippet into every page when a measurement ID is set", () => {
    const site = { ...sampleSite(), analytics: { ga4: "G-ABC123" } };
    const out = generateSite({
      site,
      settings: sampleSettings(),
      contentTypes: [],
      content: [{ type: "post", slug: "p", fields: { title: "記事" }, body: "<p>x</p>" }],
      theme: sampleTheme(),
    });
    for (const path of ["index.html", "post/p/index.html"]) {
      const head = out.files[path]!.split("</head>")[0]!;
      expect(head, path).toContain(
        'src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"',
      );
      expect(head, path).toContain("gtag('config','G-ABC123')");
    }
  });

  it("injects a custom analytics snippet verbatim and ignores a malformed GA4 id", () => {
    const site = {
      ...sampleSite(),
      analytics: { ga4: "not-an-id", headSnippet: '<script src="https://mokkeda.example/t.js"></script>' },
    };
    const out = generateSite({
      site,
      settings: sampleSettings(),
      contentTypes: [],
      content: [],
      theme: sampleTheme(),
    });
    const head = out.files["index.html"]!.split("</head>")[0]!;
    expect(head).toContain('<script src="https://mokkeda.example/t.js"></script>');
    expect(head).not.toContain("googletagmanager");
  });

  it("adds no analytics tags when none are configured", () => {
    expect(files["index.html"]).not.toContain("googletagmanager");
  });

  it("emits redirect stub pages and a _redirects file", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: { pages: {} },
      contentTypes: [],
      content: [{ type: "post", slug: "new", fields: { title: "新URL" }, body: "<p>x</p>" }],
      theme: sampleTheme(),
      redirects: [{ from: "/post/old/", to: "/post/new/" }],
    });
    const stub = out.files["post/old/index.html"]!;
    expect(stub).toContain('<meta http-equiv="refresh" content="0; url=/post/new/">');
    expect(stub).toContain('<meta name="robots" content="noindex">');
    expect(stub).toContain('<link rel="canonical" href="https://example.test/post/new/">');
    // The _redirects file carries the same mapping for Netlify/Cloudflare.
    expect(out.files["_redirects"]).toContain("/post/old/ /post/new/ 301");
    // The stub is noindex, so it stays out of the sitemap.
    expect(out.files["sitemap.xml"]).not.toContain("/post/old/");
  });

  it("never lets a redirect shadow a real page", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: { pages: {} },
      contentTypes: [],
      content: [{ type: "post", slug: "keep", fields: { title: "現役" }, body: "<p>本文</p>" }],
      theme: sampleTheme(),
      redirects: [{ from: "/post/keep/", to: "/elsewhere/" }],
    });
    // The real page wins; no redirect stub overwrites it.
    expect(out.files["post/keep/index.html"]).toContain("現役");
    expect(out.files["post/keep/index.html"]).not.toContain('http-equiv="refresh"');
    expect(out.files["_redirects"]).toBeUndefined();
  });

  it("does not flag redirect stubs in the pre-publish check", () => {
    const out = generateSite({
      site: sampleSite(),
      settings: sampleSettings(),
      contentTypes: [],
      content: [{ type: "post", slug: "new", fields: { title: "新URL" }, body: "<p>x</p>" }],
      theme: sampleTheme(),
      redirects: [
        { from: "/post/old/", to: "/post/new/" },
        { from: "/page/gone/", to: "/" },
      ],
    });
    const issues = preflight(out.files);
    // No stub triggers a missing-title/description or duplicate-title warning.
    expect(issues.some((i) => i.path === "post/old/index.html")).toBe(false);
    expect(issues.some((i) => i.path === "page/gone/index.html")).toBe(false);
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
