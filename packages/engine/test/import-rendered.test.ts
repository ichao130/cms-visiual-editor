import { describe, expect, it } from "vitest";
import { importRenderedPage } from "../src/index.js";

/**
 * Rendered-page import — the high-fidelity design path. A browser-rendered page
 * already has every section expanded and every class present, so importing it
 * (with its linked CSS supplied as text) must: fold all CSS into one stylesheet,
 * lift the header/footer into a layout, and split the main content into several
 * editable sections (NOT collapse the whole page into one).
 */

const PAGE = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.gstatic.com" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
  <link rel="stylesheet" href="/wp-content/themes/x/style.css?ver=1.2" />
  <style>.hero{color:red;background:url('/img/bg.png')}</style>
</head>
<body>
  <div id="page" class="site">
    <div class="site-inner">
      <header class="site-header">
        <a class="logo" href="/">ロゴ</a>
        <nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav>
      </header>
      <main class="site-main">
        <section class="hero"><h1>ようこそ</h1><p>リード文</p></section>
        <section class="news"><h2>お知らせ</h2>
          <div class="card-grid">
            <article class="entry-card"><h3>記事1</h3><p>本文1</p></article>
            <article class="entry-card"><h3>記事2</h3><p>本文2</p></article>
            <article class="entry-card"><h3>記事3</h3><p>本文3</p></article>
          </div>
        </section>
        <section class="cta"><h2>お問い合わせ</h2><a class="btn" href="/contact">連絡</a></section>
      </main>
      <footer class="site-footer"><p>© 会社</p></footer>
    </div>
  </div>
</body>
</html>`;

describe("importRenderedPage", () => {
  const r = importRenderedPage({
    html: PAGE,
    css: { "style.css": ".site-header{display:flex}.news{padding:40px}" },
  });

  it("folds inline <style> and the supplied linked CSS into one stylesheet", () => {
    expect(r.css).toContain(".hero{color:red");
    expect(r.css).toContain(".site-header{display:flex}");
    expect(r.css).toContain(".news{padding:40px}");
    // url() inside folded CSS is rewritten to assets/.
    expect(r.css).toContain("url('assets/bg.png')");
  });

  it("keeps the external font/CDN stylesheet as a head link in the layout", () => {
    expect(r.layout).toContain("fonts.googleapis.com");
    expect(r.layout).toContain('rel="preconnect"');
    // and links the folded stylesheet
    expect(r.layout).toContain('href="/assets/style.css"');
  });

  it("lifts header and footer into the layout, not the content", () => {
    expect(r.layout).toContain('data-slot="header"');
    expect(r.layout).toContain("site-header");
    expect(r.layout).toContain("site-footer");
    expect(r.layout).toContain('data-slot="content"');
    expect(r.html).not.toContain("site-footer");
  });

  it("splits the main content into several editable sections (not one)", () => {
    const sections = (r.html.match(/data-section=/g) ?? []).length;
    expect(sections).toBeGreaterThanOrEqual(3); // hero + news + cta
  });

  it("preserves the theme's own class names so the folded CSS still binds", () => {
    expect(r.html).toContain('class="hero"');
    expect(r.html).toContain('class="news"');
    expect(r.html).toContain("card-grid");
    expect(r.html).toContain("entry-card");
  });

  it("keeps the real repeated content verbatim (does not collapse it away)", () => {
    // A rendered page is reproduced faithfully: all three cards stay, so the
    // design isn't emptied out into a template that renders nothing.
    expect((r.html.match(/entry-card/g) ?? []).length).toBe(3);
    expect(r.html).toContain("記事1");
    expect(r.html).toContain("記事2");
    expect(r.html).toContain("記事3");
    expect(r.html).not.toContain("data-repeat");
  });

  it("makes the nav a dynamic menu", () => {
    expect(r.layout).toContain('data-loop="menu"');
  });

  it("produces no validation errors and leaves no script/php", () => {
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.html + r.layout).not.toContain("<?php");
    expect(r.html + r.layout).not.toContain("<script");
  });

  it("flags an unresolved linked stylesheet so the user can supply it", () => {
    const r2 = importRenderedPage({ html: PAGE }); // no css supplied
    expect(r2.notes.some((n) => n.includes("見つかりませんでした"))).toBe(true);
  });

  it("with a baseUrl, resolves relative images/links to the live origin", () => {
    const rel = `<!doctype html><html><body>
      <main>
        <section class="s"><h1>T</h1>
          <img src="/wp-content/up/a.jpg" />
          <img src="img/b.png" />
          <a href="/about/">About</a>
          <img src="https://cdn.example.com/c.jpg" />
        </section>
      </main>
    </body></html>`;
    const r = importRenderedPage({ html: rel, baseUrl: "https://live.example.com/news/" });
    expect(r.html).toContain("https://live.example.com/wp-content/up/a.jpg");
    expect(r.html).toContain("https://live.example.com/news/img/b.png");
    expect(r.html).toContain('href="https://live.example.com/about/"');
    // an already-absolute URL is left untouched
    expect(r.html).toContain("https://cdn.example.com/c.jpg");
  });

  it("with a baseUrl, keeps a same-origin stylesheet it wasn't given as a live link", () => {
    const r = importRenderedPage({ html: PAGE, baseUrl: "https://live.example.com/" });
    // style.css wasn't supplied here, so it stays as an absolute <link>, not dropped.
    expect(r.layout).toContain("https://live.example.com/wp-content/themes/x/style.css");
    expect(r.notes.some((n) => n.includes("見つかりませんでした"))).toBe(false);
  });
});
