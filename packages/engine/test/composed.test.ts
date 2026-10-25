import { describe, expect, it } from "vitest";
import type { SiteInput } from "../src/index.js";
import {
  generateSite,
  parseSectionSchema,
  renderComposedPage,
} from "../src/index.js";

const sections = {
  hero: '<section data-label="ヒーロー"><h1 data-field="heading">見出し</h1></section>',
  text: '<section data-label="テキスト"><h2 data-field="heading" data-if="heading">タイトル</h2><div data-field="body" data-type="richtext">本文</div></section>',
};

const layout =
  '<html><head><title data-field="site.name"></title></head><body><main data-slot="content"></main></body></html>';

function input(): SiteInput {
  return {
    site: { name: "店", baseUrl: "https://ex.test" },
    settings: {
      pages: {
        index: {
          instances: [
            { id: "i1", type: "hero", fields: { heading: "ようこそ" } },
            { id: "i2", type: "text", fields: { heading: "お店について", body: "<p>本文です</p>" } },
            { id: "i3", type: "hero", hidden: true, fields: { heading: "隠し" } },
          ],
        },
      },
    },
    contentTypes: [],
    content: [],
    theme: { config: {}, layout, templates: {}, sections },
  };
}

describe("parseSectionSchema", () => {
  it("reads a section's fields and label", () => {
    const schema = parseSectionSchema("hero", sections.hero);
    expect(schema.id).toBe("hero");
    expect(schema.label).toBe("ヒーロー");
    expect(schema.fields.map((f) => f.path)).toEqual(["heading"]);
  });
});

describe("renderComposedPage", () => {
  it("composes visible instances in order and skips hidden ones", () => {
    const { files } = generateSite(input());
    const home = files["index.html"]!;
    expect(home).toContain("ようこそ");
    expect(home).toContain("お店について");
    expect(home).toContain("<p>本文です</p>");
    expect(home).not.toContain("隠し"); // hidden instance omitted
    // order: hero before text
    expect(home.indexOf("ようこそ")).toBeLessThan(home.indexOf("お店について"));
    // section wrappers, no editor markers in published output
    expect(home).toContain('class="pcms-section pcms-section--hero"');
    expect(home).not.toContain("data-pcms-section");
    // responsive utility CSS is injected into the head
    expect(home).toContain(".pcms-hide-mobile{display:none");
  });

  it("marks instances and injects tools / insert markers in editable mode", () => {
    const html = renderComposedPage(
      [
        { id: "i1", type: "hero", fields: { heading: "X" } },
        { id: "i2", type: "text", hidden: true, fields: {} },
      ],
      sections,
      { site: { name: "店" }, theme: {}, menus: {}, collections: {} },
      { layout, markEditable: true },
    );
    expect(html).toContain('data-pcms-section="i1"');
    expect(html).toContain('data-pcms-fieldtype="text"'); // inline-edit type hint
    expect(html).toContain('data-pcms-drag="i1"'); // drag handle
    expect(html).toContain('data-pcms-op="del"'); // per-section tools
    expect(html).toContain('data-pcms-insert="0"'); // gap before first
    expect(html).toContain('data-pcms-insert="2"'); // gap after last
    // hidden instance is still rendered (dimmed) in editable mode
    expect(html).toContain("pcms-section--hidden");
  });

  it("applies per-section style overrides (background / color / padding)", () => {
    const html = renderComposedPage(
      [
        {
          id: "i1",
          type: "hero",
          fields: { heading: "X" },
          style: { background: "#112233", textColor: "#fff", paddingY: "lg" },
        },
      ],
      sections,
      { site: { name: "店" }, theme: {}, menus: {}, collections: {} },
      {},
    );
    expect(html).toContain("background-color:#112233");
    expect(html).toContain("color:#fff");
    expect(html).toContain("padding-top:5rem");
    expect(html).toContain("padding-bottom:5rem");
  });

  it("adds a device-visibility class for hideOn", () => {
    const html = renderComposedPage(
      [
        { id: "a", type: "hero", fields: {}, style: { hideOn: "mobile" } },
        { id: "b", type: "hero", fields: {}, style: { hideOn: "desktop" } },
      ],
      sections,
      { site: { name: "店" }, theme: {}, menus: {}, collections: {} },
      {},
    );
    expect(html).toContain("pcms-hide-mobile");
    expect(html).toContain("pcms-hide-desktop");
  });

  it("sanitizes a color value so it cannot break out of the attribute", () => {
    const html = renderComposedPage(
      [{ id: "i1", type: "hero", fields: {}, style: { background: 'red" onload="x' } }],
      sections,
      { site: { name: "店" }, theme: {}, menus: {}, collections: {} },
      {},
    );
    // The quote is stripped, so the value can't close the style attribute and
    // inject an event handler.
    expect(html).not.toContain('onload="');
    expect(html).toContain("background-color:red");
  });

  it("lets two instances of the same type coexist independently", () => {
    const html = renderComposedPage(
      [
        { id: "a", type: "hero", fields: { heading: "一つ目" } },
        { id: "b", type: "hero", fields: { heading: "二つ目" } },
      ],
      sections,
      { site: { name: "店" }, theme: {}, menus: {}, collections: {} },
      {},
    );
    expect(html).toContain("一つ目");
    expect(html).toContain("二つ目");
  });
});
