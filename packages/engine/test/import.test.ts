import { describe, expect, it } from "vitest";
import { cleanImportedHtml, importThemeHtml } from "../src/index.js";

describe("cleanImportedHtml", () => {
  it("strips PHP and keeps the surrounding markup", () => {
    const { html, notes } = cleanImportedHtml(
      "<section><h1><?php the_title(); ?></h1><p>こんにちは</p></section>",
    );
    expect(html).not.toContain("<?php");
    expect(html).toContain("こんにちは");
    expect(notes.some((n) => n.includes("PHP"))).toBe(true);
  });

  it("strips Liquid expressions and block tags", () => {
    const { html } = cleanImportedHtml(
      "<ul>{% for p in products %}<li>{{ p.title }}</li>{% endfor %}</ul>",
    );
    expect(html).not.toContain("{%");
    expect(html).not.toContain("{{");
    expect(html).toContain("<li>");
  });

  it("removes scripts and inline event handlers", () => {
    const { html } = cleanImportedHtml(
      '<div onclick="steal()"><script>alert(1)</script><a href="javascript:evil()">x</a></div>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
  });

  it("extracts the body from a full document and drops the head", () => {
    const { html, notes } = cleanImportedHtml(
      "<!doctype html><html><head><title>t</title><style>x{}</style></head><body><main>本文</main></body></html>",
    );
    expect(html).toContain("本文");
    expect(html).not.toContain("<title>");
    // <style> is lifted out of the head and kept (covered in the styles suite).
    expect(notes.some((n) => n.includes("head"))).toBe(true);
  });
});

describe("cleanImportedHtml — styles", () => {
  it("keeps <style> and lifts it above the extracted body", () => {
    const { html, notes } = cleanImportedHtml(
      "<html><head><style>.hero{color:red}</style></head><body><section>x</section></body></html>",
    );
    expect(html).toContain("<style>");
    expect(html).toContain(".hero{color:red}");
    expect(notes.some((n) => n.includes("スタイル"))).toBe(true);
  });
});

describe("importThemeHtml — repeats", () => {
  it("collapses a list of similar cards into one data-repeat item", () => {
    const raw =
      '<body><section class="products">' +
      '<article class="card"><h3>A</h3><p>説明A</p></article>' +
      '<article class="card"><h3>B</h3><p>説明B</p></article>' +
      '<article class="card"><h3>C</h3><p>説明C</p></article>' +
      "</section></body>";
    const { html, notes } = importThemeHtml(raw);
    // Exactly one repeat item remains, with bare field names.
    expect((html.match(/data-repeat=/g) ?? [])).toHaveLength(1);
    expect((html.match(/<article/g) ?? [])).toHaveLength(1);
    expect(html).toContain('data-field="f1"');
    expect(html).not.toContain("説明B");
    expect(notes.some((n) => n.includes("繰り返し"))).toBe(true);
  });

  it("does not collapse distinct top-level sections", () => {
    const raw =
      "<body>" +
      '<section class="hero"><h1>見出し</h1></section>' +
      '<section class="news"><h2>お知らせ</h2></section>' +
      '<section class="about"><h2>紹介</h2></section>' +
      "</body>";
    const { html } = importThemeHtml(raw);
    expect((html.match(/data-repeat=/g) ?? [])).toHaveLength(0);
    expect((html.match(/<section/g) ?? [])).toHaveLength(3);
  });
});

describe("importThemeHtml — menus", () => {
  it("turns a nav list of links into a data-loop menu", () => {
    const raw =
      "<body><nav><ul>" +
      '<li><a href="/">ホーム</a></li>' +
      '<li><a href="/about">紹介</a></li>' +
      '<li><a href="/contact">お問い合わせ</a></li>' +
      "</ul></nav></body>";
    const { html, notes } = importThemeHtml(raw);
    expect(html).toContain('data-loop="menu"');
    expect(html).toContain('data-field="item.url"');
    expect(html).toContain('data-field="item.label"');
    // Only one menu item remains as the pattern.
    expect((html.match(/<li/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("お問い合わせ");
    expect(notes.some((n) => n.includes("メニュー"))).toBe(true);
  });
});

describe("importThemeHtml — media optimization", () => {
  it("lazy-loads images, adds alt, and hardens blank-target links", () => {
    const raw =
      '<body><section><img src="a.jpg">' +
      '<a href="https://x.test" target="_blank">外部</a></section></body>';
    const { html, notes } = importThemeHtml(raw);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    // An empty alt serializes as a bare `alt` attribute — just assert it exists.
    expect(html).toMatch(/<img[^>]*\balt\b/);
    expect(html).toContain('rel="noopener"');
    expect(notes.some((n) => n.includes("画像を最適化"))).toBe(true);
    expect(notes.some((n) => n.includes("noopener"))).toBe(true);
  });

  it("keeps an image's existing alt and loading", () => {
    const { html } = importThemeHtml('<body><section><img src="a.jpg" alt="写真" loading="eager"></section></body>');
    expect(html).toContain('alt="写真"');
    expect(html).toContain('loading="eager"');
    expect(html).not.toContain('loading="lazy"');
  });
});

describe("importThemeHtml — section labels", () => {
  it("labels a section from its heading", () => {
    const { html } = importThemeHtml('<body><section class="x"><h2>お知らせ</h2><p>本文</p></section></body>');
    expect(html).toContain('data-label="お知らせ"');
    expect(html).not.toContain('data-label="セクション1"');
  });

  it("labels a section from a known class when it has no heading", () => {
    const { html, notes } = importThemeHtml('<body><section class="hero"><p>リード</p><a href="#">CTA</a></section></body>');
    expect(html).toContain('data-label="ヒーロー"');
    expect(notes.some((n) => n.includes("セクション名"))).toBe(true);
  });
});

describe("importThemeHtml — layout split", () => {
  it("splits header/footer into a layout and keeps the middle as content", () => {
    const raw =
      "<body>" +
      "<header><h1>ロゴ</h1></header>" +
      '<section class="hero"><h2>ようこそ</h2><p>本文</p></section>' +
      "<footer><p>© 2026</p></footer>" +
      "</body>";
    const { html, layout, notes } = importThemeHtml(raw);
    expect(layout).toBeDefined();
    expect(layout).toContain("<header");
    expect(layout).toContain("<footer");
    expect(layout).toContain('data-slot="content"');
    // Content is the middle only — no chrome.
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<footer");
    expect(html).toContain("ようこそ");
    expect(notes.some((n) => n.includes("共通レイアウト"))).toBe(true);
  });

  it("does not split when there is no footer", () => {
    const raw =
      "<body><header><h1>ロゴ</h1></header>" +
      '<section class="hero"><h2>ようこそ</h2></section></body>';
    const { html, layout } = importThemeHtml(raw);
    expect(layout).toBeUndefined();
    expect(html).toContain("<header");
  });

  it("keeps top-level <style> in the layout, not the content", () => {
    const raw =
      "<html><head><style>.hero{color:red}</style></head><body>" +
      "<header><h1>ロゴ</h1></header>" +
      '<section class="hero"><h2>ようこそ</h2></section>' +
      "<footer><p>© 2026</p></footer>" +
      "</body></html>";
    const { html, layout } = importThemeHtml(raw);
    expect(layout).toContain("<style>");
    expect(layout).toContain(".hero{color:red}");
    expect(html).not.toContain("<style>");
  });
});

describe("importThemeHtml — Figma/SVG", () => {
  it("wraps an SVG as a design section and makes text editable", () => {
    const raw =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">' +
      '<rect width="400" height="200" fill="#eef"/>' +
      '<text x="20" y="40">見出しテキスト</text>' +
      '<text x="20" y="80">説明テキスト</text>' +
      "</svg>";
    const { html, issues, notes } = importThemeHtml(raw);
    expect(html).toContain('data-section="sec-1"');
    expect(html).toContain("<svg");
    expect(html).toContain('data-field="sec-1.f1"');
    expect(html).toContain('data-field="sec-1.f2"');
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(notes.some((n) => n.includes("Figma/SVG"))).toBe(true);
    expect(notes.some((n) => n.includes("2個のテキスト"))).toBe(true);
  });
});

describe("importThemeHtml", () => {
  it("cleans a WordPress-ish template and annotates editable sections", () => {
    const raw =
      "<!doctype html><html><body>" +
      '<section class="hero"><h1><?php the_title(); ?></h1><p>リード文</p><img src="hero.jpg"></section>' +
      '<section class="news"><h2>お知らせ</h2><p><a href="#">続きを読む</a></p></section>' +
      "</body></html>";
    const { html, issues, notes } = importThemeHtml(raw);

    expect(html).not.toContain("<?php");
    expect(html).toContain('data-section="sec-1"');
    expect(html).toContain('data-section="sec-2"');
    expect(html).toContain('data-field="sec-1.f1"');
    expect(html).toContain('data-type="image"');
    // No validation errors on a clean conversion (warnings are acceptable).
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(notes.some((n) => n.includes("セクション"))).toBe(true);
  });
});
