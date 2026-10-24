import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/index.js";

describe("renderMarkdown", () => {
  it("renders headings, paragraphs and inline marks", () => {
    const html = renderMarkdown("# 見出し\n\n本文に**強調**と*斜体*。");
    expect(html).toContain("<h1>見出し</h1>");
    expect(html).toContain("<strong>強調</strong>");
    expect(html).toContain("<em>斜体</em>");
  });

  it("renders unordered lists", () => {
    const html = renderMarkdown("- 一つ\n- 二つ");
    expect(html).toBe("<ul><li>一つ</li><li>二つ</li></ul>");
  });

  it("escapes HTML in text", () => {
    const html = renderMarkdown("<script>alert(1)</script> は危険");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders links", () => {
    const html = renderMarkdown("[サイト](https://example.test)");
    expect(html).toContain('<a href="https://example.test">サイト</a>');
  });
});
