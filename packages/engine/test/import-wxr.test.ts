import { describe, expect, it } from "vitest";
import { parseWxr, wxrBodyToHtml, type WxrImportResult } from "../src/index.js";

/**
 * WXR content import. A theme ZIP has no content; the real pages/posts come from
 * a WordPress export (WXR XML), whose `content:encoded` is Gutenberg block markup.
 * These tests model the real agi-content.xml shapes (front page + 固定ページ + 投稿,
 * CDATA bodies, category terms, an external image).
 */

const WXR = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>テスト協会</title>
  <wp:base_blog_url>https://example.jp</wp:base_blog_url>
  <item>
    <title><![CDATA[ホーム]]></title>
    <link>https://example.jp/home/</link>
    <wp:post_id>101</wp:post_id>
    <wp:post_date><![CDATA[2026-02-01 09:00:00]]></wp:post_date>
    <wp:post_name><![CDATA[home]]></wp:post_name>
    <wp:status><![CDATA[publish]]></wp:status>
    <wp:post_parent>0</wp:post_parent>
    <wp:post_type><![CDATA[page]]></wp:post_type>
    <content:encoded><![CDATA[<!-- wp:heading {"level":2} -->
<h2 class="wp-block-heading">主要サービス</h2>
<!-- /wp:heading -->
<!-- wp:paragraph -->
<p>海洋環境を守ります。</p>
<!-- /wp:paragraph -->]]></content:encoded>
  </item>
  <item>
    <title><![CDATA[協会について]]></title>
    <wp:post_id>102</wp:post_id>
    <dc:creator><![CDATA[AGI事務局]]></dc:creator>
    <wp:post_date><![CDATA[2026-02-02 10:00:00]]></wp:post_date>
    <wp:post_name><![CDATA[about]]></wp:post_name>
    <wp:status><![CDATA[publish]]></wp:status>
    <wp:post_parent>0</wp:post_parent>
    <wp:post_type><![CDATA[page]]></wp:post_type>
    <content:encoded><![CDATA[<!-- wp:paragraph -->
<p>私たちは<strong>海洋協会</strong>です。</p>
<!-- /wp:paragraph -->
<!-- wp:image -->
<figure class="wp-block-image"><img src="https://example.jp/wp-content/uploads/office.jpg" alt=""/></figure>
<!-- /wp:image -->]]></content:encoded>
  </item>
  <item>
    <title><![CDATA[沿革]]></title>
    <wp:post_id>103</wp:post_id>
    <wp:post_name><![CDATA[history]]></wp:post_name>
    <wp:status><![CDATA[draft]]></wp:status>
    <wp:post_parent>102</wp:post_parent>
    <wp:post_type><![CDATA[page]]></wp:post_type>
    <content:encoded><![CDATA[<!-- wp:paragraph --><p>1990年設立。</p><!-- /wp:paragraph -->]]></content:encoded>
  </item>
  <item>
    <title><![CDATA[リニューアルのお知らせ]]></title>
    <wp:post_id>201</wp:post_id>
    <wp:post_date><![CDATA[2026-02-10 09:00:00]]></wp:post_date>
    <wp:post_name><![CDATA[renewal-2026]]></wp:post_name>
    <wp:status><![CDATA[publish]]></wp:status>
    <wp:post_parent>0</wp:post_parent>
    <wp:post_type><![CDATA[post]]></wp:post_type>
    <category domain="category" nicename="oshirase"><![CDATA[お知らせ]]></category>
    <category domain="post_tag" nicename="web"><![CDATA[Web]]></category>
    <content:encoded><![CDATA[<!-- wp:paragraph --><p>サイトを更新しました。</p><!-- /wp:paragraph -->]]></content:encoded>
  </item>
  <item>
    <title><![CDATA[画像メニュー]]></title>
    <wp:post_id>301</wp:post_id>
    <wp:post_name><![CDATA[logo]]></wp:post_name>
    <wp:status><![CDATA[inherit]]></wp:status>
    <wp:post_type><![CDATA[attachment]]></wp:post_type>
    <content:encoded><![CDATA[]]></content:encoded>
  </item>
</channel>
</rss>`;

describe("wxrBodyToHtml", () => {
  it("strips wp block delimiters and keeps the inner HTML", () => {
    const out = wxrBodyToHtml(`<!-- wp:heading -->\n<h2>見出し</h2>\n<!-- /wp:heading -->`);
    expect(out).toBe("<h2>見出し</h2>");
    expect(out).not.toContain("<!-- wp:");
  });
});

describe("parseWxr", () => {
  const r: WxrImportResult = parseWxr(WXR);

  it("skips attachments and keeps only page/post items (home excluded from items)", () => {
    // 2 pages (about, history) + 1 post; home is pulled out, attachment skipped.
    expect(r.items.map((i) => i.item.slug).sort()).toEqual(["about", "history", "renewal-2026"]);
  });

  it("pulls the front page out as `home` and converts its body", () => {
    expect(r.home?.title).toBe("ホーム");
    expect(r.home?.html).toContain("<h2 class=\"wp-block-heading\">主要サービス</h2>");
    expect(r.home?.html).not.toContain("<!-- wp:");
  });

  it("maps title/date/author/status into ContentItem fields", () => {
    const about = r.items.find((i) => i.item.slug === "about")!.item;
    expect(about.type).toBe("page");
    expect(about.fields.title).toBe("協会について");
    expect(about.fields.date).toBe("2026-02-02");
    expect(about.fields.author).toBe("AGI事務局");
    expect(about.status).toBe("published");
    expect(about.body).toContain("<strong>海洋協会</strong>");
  });

  it("maps draft status and resolves parent id → parent slug", () => {
    const history = r.items.find((i) => i.item.slug === "history")!.item;
    expect(history.status).toBe("draft");
    expect(history.parent).toBe("about"); // post_parent 102 → about
  });

  it("maps category/post_tag terms into fields.category / fields.tag (arrays)", () => {
    const post = r.items.find((i) => i.item.slug === "renewal-2026")!.item;
    expect(post.type).toBe("post");
    expect(post.fields.category).toEqual(["お知らせ"]);
    expect(post.fields.tag).toEqual(["Web"]);
  });

  it("collects external image URLs as unresolved (kept in the body)", () => {
    expect(r.unresolvedImages).toContain("https://example.jp/wp-content/uploads/office.jpg");
    const about = r.items.find((i) => i.item.slug === "about")!.item;
    expect(about.body).toContain("office.jpg"); // URL stays; flagged for re-upload
  });

  it("leaves no raw PHP or wp-comment delimiters in any body", () => {
    for (const { item } of r.items) {
      expect(item.body).not.toContain("<?php");
      expect(item.body).not.toContain("<!-- wp:");
    }
  });

  it("reports counts and image warning in notes", () => {
    expect(r.notes.some((n) => n.includes("固定ページ 2件"))).toBe(true);
    expect(r.notes.some((n) => n.includes("投稿 1件"))).toBe(true);
    expect(r.notes.some((n) => n.includes("画像"))).toBe(true);
  });
});
