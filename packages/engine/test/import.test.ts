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
    expect(html).not.toContain("<style>");
    expect(notes.some((n) => n.includes("head"))).toBe(true);
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
