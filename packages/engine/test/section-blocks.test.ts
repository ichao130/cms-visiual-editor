import { describe, expect, it } from "vitest";
import type { SiteInput } from "../src/index.js";
import { generateSite, renderComposedPage, sectionBlockTypes } from "../src/index.js";

const sections = {
  // A section whose template has a nested-block container.
  features:
    '<section class="features"><h2 data-field="title">特長</h2>' +
    '<div class="features__list" data-blocks="feature"><p>placeholder</p></div></section>',
  hero: '<section><h1 data-field="heading">H</h1></section>',
};

const blocks = {
  feature:
    '<div class="feature"><h3 data-field="title" data-type="text">見出し</h3>' +
    '<p data-field="text">本文</p></div>',
};

const layout =
  "<html><head></head><body><main data-slot=\"content\"></main></body></html>";

function baseInput(instanceBlocks?: SiteInput["settings"]["pages"]["index"]["instances"]): SiteInput {
  return {
    site: { name: "店", baseUrl: "https://ex.test" },
    settings: {
      pages: {
        index: {
          instances: instanceBlocks ?? [
            {
              id: "feat-1",
              type: "features",
              fields: { title: "選ばれる理由" },
              blocks: [
                { id: "b1", type: "feature", fields: { title: "品質", text: "厳選した豆" } },
                { id: "b2", type: "feature", fields: { title: "焙煎" } },
              ],
            },
          ],
        },
      },
    },
    contentTypes: [],
    content: [],
    theme: { config: {}, layout, templates: { page: "<main></main>" }, sections, blocks },
  };
}

const base = { site: { name: "店" }, theme: {}, menus: {}, collections: {} };

describe("nested section blocks", () => {
  it("renders a section instance's blocks into its data-blocks container (published)", () => {
    const { files } = generateSite(baseInput());
    const home = files["index.html"]!;
    expect(home).toContain("選ばれる理由"); // section field
    expect(home).toContain("品質"); // block 1 title
    expect(home).toContain("厳選した豆"); // block 1 text
    expect(home).toContain("焙煎"); // block 2 title
    // the template's placeholder child is replaced by the blocks
    expect(home).not.toContain("placeholder");
    // clean output: no editor markers, no data-blocks attribute
    expect(home).not.toContain("data-pcms-block");
    expect(home).not.toContain("pcms-insert");
    expect(home).not.toContain("data-blocks");
  });

  it("wraps blocks with markers + tools in editable preview", () => {
    const html = renderComposedPage(
      baseInput().settings.pages.index!.instances!,
      sections,
      base,
      { layout, markEditable: true, blocks },
    );
    expect(html).toContain('data-pcms-block="b1"');
    expect(html).toContain('data-pcms-blocksection="feat-1"');
    expect(html).toContain("data-pcms-blockinsert");
    expect(html).toContain('data-pcms-blockop="del"');
    // block fields are marked so they can be clicked / inline-edited
    expect(html).toContain('data-pcms-field="title"');
    expect(html).toContain('data-pcms-field="text"');
  });

  it("shows the add hint + a marker for an empty-blocks section in the editor", () => {
    const instances = [{ id: "feat-1", type: "features", blocks: [] }];
    const html = renderComposedPage(instances, sections, base, {
      layout,
      markEditable: true,
      blocks,
    });
    expect(html).toContain("ブロックがありません");
    expect(html).toContain("data-pcms-blockinsert");
    expect(html).not.toContain("placeholder");
  });

  it("leaves an empty-blocks container clean in published output", () => {
    const { files } = generateSite(baseInput([{ id: "feat-1", type: "features", blocks: [] }]));
    const home = files["index.html"]!;
    expect(home).not.toContain("pcms-insert");
    expect(home).not.toContain("data-blocks");
    expect(home).not.toContain("placeholder");
    // the container itself survives (empty)
    expect(home).toContain('class="features__list"');
  });

  it("renders nothing for the container when the instance has no blocks array (backward compatible)", () => {
    // Older data: a section whose template gained data-blocks but the instance
    // predates blocks. It must not crash; the container renders empty.
    const { files } = generateSite(baseInput([{ id: "feat-1", type: "features" }]));
    const home = files["index.html"]!;
    expect(home).toContain('class="features__list"');
    expect(home).not.toContain("placeholder");
  });

  it("sectionBlockTypes reads the allow-list, or null when absent", () => {
    expect(sectionBlockTypes(sections.features)).toEqual(["feature"]);
    expect(sectionBlockTypes('<div data-blocks=""></div>')).toEqual([]);
    expect(sectionBlockTypes('<div data-blocks="a b  c"></div>')).toEqual(["a", "b", "c"]);
    expect(sectionBlockTypes(sections.hero)).toBeNull();
  });
});
