import { describe, expect, it } from "vitest";
import { blocksToHtml, htmlToBlocks, type Block } from "../src/blocks.js";

describe("htmlToBlocks / blocksToHtml", () => {
  it("parses a typical body into blocks", () => {
    const blocks = htmlToBlocks(
      "<h2>ごあいさつ</h2><p>本日<strong>開店</strong>しました。</p>",
    );
    expect(blocks).toEqual<Block[]>([
      { type: "heading", level: 2, html: "ごあいさつ" },
      { type: "paragraph", html: "本日<strong>開店</strong>しました。" },
    ]);
  });

  it("round-trips the blocks it produces", () => {
    const html =
      '<h2>見出し</h2>\n<p>段落です。</p>\n<ul><li>一つ</li><li>二つ</li></ul>\n' +
      '<blockquote>引用文</blockquote>\n<img src="/media/a.jpg" alt="写真">\n<hr>';
    const blocks = htmlToBlocks(html);
    expect(blocksToHtml(blocks)).toBe(html);
  });

  it("maps h1/h4-6 onto the two supported heading levels", () => {
    expect(htmlToBlocks("<h1>a</h1><h4>b</h4>")).toEqual<Block[]>([
      { type: "heading", level: 2, html: "a" },
      { type: "heading", level: 3, html: "b" },
    ]);
  });

  it("extracts ordered and unordered list items", () => {
    const blocks = htmlToBlocks("<ol><li>一</li><li>二</li></ol>");
    expect(blocks).toEqual<Block[]>([{ type: "list", ordered: true, items: ["一", "二"] }]);
  });

  it("unwraps a paragraph-wrapped blockquote", () => {
    expect(htmlToBlocks("<blockquote><p>声</p></blockquote>")).toEqual<Block[]>([
      { type: "quote", html: "声" },
    ]);
  });

  it("keeps an unknown element as a raw html block", () => {
    const html = '<table><tr><td>x</td></tr></table>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("html");
  });

  it("strips scripts, event handlers and javascript: links from inline text", () => {
    const blocks = htmlToBlocks(
      '<p>safe <a href="javascript:evil()" onclick="x()">link</a> <span>text</span></p>' +
        '<script>alert(1)</script>',
    );
    expect(blocks).toEqual<Block[]>([{ type: "paragraph", html: "safe link text" }]);
  });

  it("keeps a safe link with its href", () => {
    expect(htmlToBlocks('<p>go <a href="/about/">here</a></p>')).toEqual<Block[]>([
      { type: "paragraph", html: 'go <a href="/about/">here</a>' },
    ]);
  });

  it("promotes bare text to a paragraph and drops empty paragraphs", () => {
    expect(htmlToBlocks("hi<p></p><p>  </p>")).toEqual<Block[]>([
      { type: "paragraph", html: "hi" },
    ]);
  });

  it("round-trips an image with a caption as a figure", () => {
    const html = '<figure><img src="/m/a.jpg" alt="写真"><figcaption>説明文</figcaption></figure>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toEqual<Block[]>([
      { type: "image", src: "/m/a.jpg", alt: "写真", caption: "説明文" },
    ]);
    expect(blocksToHtml(blocks)).toBe(html);
  });

  it("round-trips a gallery block", () => {
    const html = '<div class="pcms-gallery"><img src="/m/1.jpg" alt="一"><img src="/m/2.jpg" alt="二"></div>';
    const blocks = htmlToBlocks(html);
    expect(blocks).toEqual<Block[]>([
      {
        type: "gallery",
        images: [
          { src: "/m/1.jpg", alt: "一" },
          { src: "/m/2.jpg", alt: "二" },
        ],
      },
    ]);
    expect(blocksToHtml(blocks)).toBe(html);
  });

  it("escapes special characters when serializing an image", () => {
    const html = blocksToHtml([{ type: "image", src: "/m/a&b.jpg", alt: '"q"' }]);
    expect(html).toBe('<img src="/m/a&amp;b.jpg" alt="&quot;q&quot;">');
  });
});
