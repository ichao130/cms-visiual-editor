import { describe, expect, it } from "vitest";
import type { SiteInput } from "../src/index.js";
import { generateSite } from "../src/index.js";

const layout =
  '<html><head><title data-field="site.name"></title></head><body><main data-slot="content"></main></body></html>';

const archive = `
<section class="archive">
  <h1 data-field="term.value" data-if="term.value">分類</h1>
  <ul class="list">
    <li data-loop="items"><a data-field="item.url" href="#"><span data-field="item.title"></span></a></li>
  </ul>
  <nav class="pager">
    <a class="prev" data-field="pagination.prevUrl" data-if="pagination.prevUrl" href="#">前へ</a>
    <span class="label" data-field="pagination.label"></span>
    <a class="next" data-field="pagination.nextUrl" data-if="pagination.nextUrl" href="#">次へ</a>
  </nav>
</section>`;

function input(): SiteInput {
  return {
    site: {
      name: "テスト店",
      baseUrl: "https://ex.test",
      permalink: "/:type/:slug/",
      archivePageSize: 2,
    },
    settings: { pages: { index: {} } },
    contentTypes: [
      { name: "post", label: "投稿", fields: [{ name: "title", label: "題", type: "text" }] },
    ],
    content: [
      { type: "post", slug: "a", fields: { title: "記事A", date: "2026-03-03", category: "お知らせ" }, body: "<p>A</p>" },
      { type: "post", slug: "b", fields: { title: "記事B", date: "2026-03-02", category: "お知らせ" }, body: "<p>B</p>" },
      { type: "post", slug: "c", fields: { title: "記事C", date: "2026-03-01", category: "イベント" }, body: "<p>C</p>" },
    ],
    theme: {
      config: {},
      layout,
      templates: {
        index: '<h1 data-field="site.name"></h1>',
        post: '<article><h1 data-field="post.title"></h1><div data-field="post.body" data-type="richtext"></div></article>',
        archive,
      },
    },
    taxonomies: [
      { name: "category", label: "カテゴリ", types: ["post"], terms: ["お知らせ", "イベント"], multiple: false },
    ],
  };
}

describe("archives + pagination", () => {
  const { files } = generateSite(input());

  it("generates a paginated type archive (3 posts, size 2 → 2 pages)", () => {
    expect(files["post/index.html"]).toBeDefined();
    expect(files["post/page/2/index.html"]).toBeDefined();
    expect(files["post/index.html"]).toContain("1 / 2");
    expect(files["post/index.html"]).toContain('href="/post/page/2/"'); // next
    expect(files["post/page/2/index.html"]).toContain('href="/post/"'); // prev
  });

  it("puts the right items on each archive page, newest first", () => {
    const p1 = files["post/index.html"]!;
    const p2 = files["post/page/2/index.html"]!;
    expect(p1).toContain("記事A");
    expect(p1).toContain("記事B");
    expect(p1).not.toContain("記事C");
    expect(p2).toContain("記事C");
  });

  it("generates taxonomy term archives with only that term's items", () => {
    const newsKey = Object.keys(files).find(
      (k) => k.startsWith("category/") && k.endsWith("index.html") && !k.includes("page/"),
    );
    // Two terms → at least two category archive pages exist.
    const catPages = Object.keys(files).filter((k) => k.startsWith("category/"));
    expect(catPages.length).toBeGreaterThanOrEqual(2);
    const news = files[newsKey!]!;
    // お知らせ archive lists A and B but not C.
    const hasNews = Object.values(files).some(
      (h) => h.includes("お知らせ") && h.includes("記事A") && h.includes("記事B") && !h.includes("記事C"),
    );
    expect(hasNews).toBe(true);
    expect(news).toContain("お知らせ"); // term value bound into the archive
  });
});

describe("structured data", () => {
  const { files } = generateSite(input());

  it("injects WebSite + Organization on pages", () => {
    expect(files["index.html"]).toContain('"@type":"WebSite"');
    expect(files["index.html"]).toContain('"@type":"Organization"');
  });

  it("injects Article + BreadcrumbList on a content item page", () => {
    const post = files["post/a/index.html"]!;
    expect(post).toContain('"@type":"Article"');
    expect(post).toContain('"headline":"記事A"');
    expect(post).toContain('"@type":"BreadcrumbList"');
    expect(post).toContain('"name":"投稿"'); // type label in breadcrumb
  });

  it("includes archive URLs in the sitemap", () => {
    expect(files["sitemap.xml"]).toContain("https://ex.test/post/");
  });
});
