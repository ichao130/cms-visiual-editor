import { describe, expect, it } from "vitest";
import { collectInternalLinks } from "../src/index.js";

/**
 * collectInternalLinks discovers the same-origin 固定ページ a rendered home links
 * to (so a URL import can reproduce them too, not just the home). It prefers the
 * global nav, drops the home / files / external / mail links, and dedupes.
 */

const HOME = `<!doctype html><html><body>
  <header>
    <a class="logo" href="/">ロゴ</a>
    <nav class="global-menu">
      <ul>
        <li><a href="/about/">会社概要</a></li>
        <li><a href="/service/">サービス</a></li>
        <li><a href="https://aogi.jp/company/profile/">役員紹介</a></li>
        <li><a href="/contact/">お問い合わせ</a></li>
        <li><a href="https://twitter.com/x">外部SNS</a></li>
        <li><a href="/docs/guide.pdf">資料PDF</a></li>
        <li><a href="mailto:a@b.jp">メール</a></li>
        <li><a href="#top">トップへ</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <article><a href="/news/2024/">本文内の記事リンク</a></article>
    <a href="/about/">重複リンク（本文）</a>
  </main>
</body></html>`;

describe("collectInternalLinks", () => {
  const pages = collectInternalLinks(HOME, "https://aogi.jp/");

  it("finds the same-origin nav pages", () => {
    const slugs = pages.map((p) => p.slug);
    expect(slugs).toContain("about");
    expect(slugs).toContain("service");
    expect(slugs).toContain("company/profile");
    expect(slugs).toContain("contact");
  });

  it("keeps the link text as the label and the absolute URL to fetch", () => {
    const about = pages.find((p) => p.slug === "about");
    expect(about?.label).toBe("会社概要");
    expect(about?.url).toBe("https://aogi.jp/about/");
    const prof = pages.find((p) => p.slug === "company/profile");
    expect(prof?.url).toBe("https://aogi.jp/company/profile/");
  });

  it("drops the home, external, file, mail and anchor links", () => {
    const urls = pages.map((p) => p.url);
    expect(urls.some((u) => u.includes("twitter.com"))).toBe(false);
    expect(urls.some((u) => u.endsWith(".pdf"))).toBe(false);
    expect(urls.some((u) => u.startsWith("mailto:"))).toBe(false);
    // the home ("/") is never a candidate
    expect(pages.some((p) => p.slug === "")).toBe(false);
  });

  it("dedupes a page linked more than once", () => {
    expect(pages.filter((p) => p.slug === "about").length).toBe(1);
  });

  it("prefers nav links over body links when a nav exists", () => {
    // /news/2024/ sits only in <main>, outside the nav, so with a real nav it is
    // not pulled in (the nav is the 固定ページ signal).
    expect(pages.some((p) => p.slug === "news/2024")).toBe(false);
  });

  it("falls back to all same-origin links when there is no nav", () => {
    const noNav = `<!doctype html><html><body><main>
      <a href="/about/">A</a><a href="/service/">B</a>
    </main></body></html>`;
    const p = collectInternalLinks(noNav, "https://x.test/");
    expect(p.map((x) => x.slug).sort()).toEqual(["about", "service"]);
  });

  it("returns nothing for an unparseable base URL", () => {
    expect(collectInternalLinks(HOME, "not a url")).toEqual([]);
  });
});
