import { describe, expect, it } from "vitest";
import type { SiteInput } from "../src/index.js";
import {
  generateSite,
  isColumnsBlock,
  renderComposedPage,
} from "../src/index.js";

// A section that accepts any block (empty allow-list).
const sections = {
  body:
    '<section class="body"><div class="body__blocks" data-blocks=""><p>ph</p></div></section>',
};

// Block parts: a plain "text" block, and a "columns" layout block whose root
// carries data-columns (its children live in the instance's `columns`).
const blocks = {
  text: '<div class="block-text"><p data-field="body" data-type="richtext">本文</p></div>',
  columns:
    '<div class="block-columns" data-block data-label="カラム">' +
    '<div class="pcms-columns" data-columns></div></div>',
};

const layout =
  '<html><head></head><body><main data-slot="content"></main></body></html>';

function input(
  instances: SiteInput["settings"]["pages"]["index"]["instances"],
): SiteInput {
  return {
    site: { name: "店", baseUrl: "https://ex.test" },
    settings: { pages: { index: { instances } } },
    contentTypes: [],
    content: [],
    theme: { config: {}, layout, templates: { page: "<main></main>" }, sections, blocks },
  };
}

const twoColInstances = [
  {
    id: "sec-1",
    type: "body",
    blocks: [
      {
        id: "col-1",
        type: "columns",
        fields: { ratio: "2:1" },
        columns: [
          [{ id: "c1a", type: "text", fields: { body: "左のテキスト" } }],
          [{ id: "c1b", type: "text", fields: { body: "右のテキスト" } }],
        ],
      },
    ],
  },
];

const base = { site: { name: "店" }, theme: {}, menus: {}, collections: {} };

describe("layout (columns) blocks", () => {
  it("renders one column per entry with child blocks (published)", () => {
    const { files } = generateSite(input(twoColInstances));
    const home = files["index.html"]!;
    expect(home).toContain("左のテキスト");
    expect(home).toContain("右のテキスト");
    // two column wrappers
    expect(home.match(/pcms-columns__col/g)?.length).toBe(2);
    // width ratio → grid tracks
    expect(home).toContain("grid-template-columns:2fr 1fr");
    // clean output: no layout attribute, no editor markers
    expect(home).not.toContain("data-columns");
    expect(home).not.toContain("data-pcms-block");
  });

  it("falls back to equal tracks when the ratio is missing or malformed", () => {
    const noRatio = [
      {
        id: "sec-1",
        type: "body",
        blocks: [
          {
            id: "col-1",
            type: "columns",
            columns: [
              [{ id: "a", type: "text", fields: { body: "A" } }],
              [{ id: "b", type: "text", fields: { body: "B" } }],
            ],
          },
        ],
      },
    ];
    const { files } = generateSite(input(noRatio));
    expect(files["index.html"]!).toContain("grid-template-columns:1fr 1fr");
  });

  it("shows an empty-column placeholder in the editable preview only", () => {
    const withEmpty = [
      {
        id: "sec-1",
        type: "body",
        blocks: [
          {
            id: "col-1",
            type: "columns",
            fields: { ratio: "1:1" },
            columns: [[{ id: "a", type: "text", fields: { body: "A" } }], []],
          },
        ],
      },
    ];
    const preview = renderComposedPage(withEmpty, sections, base, {
      layout,
      markEditable: true,
      blocks,
    });
    expect(preview).toContain("空のカラム");
    // the layout block itself still gets the section-level block markers
    expect(preview).toContain('data-pcms-block="col-1"');

    const { files } = generateSite(input(withEmpty));
    expect(files["index.html"]!).not.toContain("空のカラム");
  });

  it("isColumnsBlock detects a layout block template", () => {
    expect(isColumnsBlock(blocks.columns)).toBe(true);
    expect(isColumnsBlock(blocks.text)).toBe(false);
  });
});
