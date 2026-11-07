import { describe, expect, it } from "vitest";
import {
  blockPartTemplate,
  parseSectionSchema,
  sectionBlockTypes,
  setSectionBlocks,
} from "../src/index.js";

describe("setSectionBlocks", () => {
  it("adds a data-blocks slot to a section that has none (allow any)", () => {
    const before = '<section class="hero"><h1 data-field="heading">H</h1></section>';
    expect(sectionBlockTypes(before)).toBeNull();
    const after = setSectionBlocks(before, []);
    expect(sectionBlockTypes(after)).toEqual([]); // [] = any block type
    expect(after).toContain('data-blocks=""');
    // the container is appended inside the section root
    expect(after).toMatch(/<div class="pcms-blocks" data-blocks="">[\s\S]*<\/div>\s*<\/section>/);
  });

  it("adds a slot restricted to the given block types", () => {
    const after = setSectionBlocks('<section><h2>x</h2></section>', ["feature", "logo"]);
    expect(sectionBlockTypes(after)).toEqual(["feature", "logo"]);
  });

  it("updates an existing slot's allow-list in place (no duplicate container)", () => {
    const once = setSectionBlocks('<section></section>', ["feature"]);
    const twice = setSectionBlocks(once, ["feature", "logo"]);
    expect(sectionBlockTypes(twice)).toEqual(["feature", "logo"]);
    expect(twice.match(/data-blocks=/g)).toHaveLength(1);
  });

  it("removes the slot when allowed is null", () => {
    const withSlot = setSectionBlocks('<section></section>', ["feature"]);
    const removed = setSectionBlocks(withSlot, null);
    expect(sectionBlockTypes(removed)).toBeNull();
    expect(removed).not.toContain("data-blocks");
  });
});

describe("blockPartTemplate", () => {
  it("produces a data-block part readable by the schema parser", () => {
    const html = blockPartTemplate("promo", "プロモ");
    expect(html).toContain("data-block");
    const schema = parseSectionSchema("promo", html);
    expect(schema.label).toBe("プロモ");
    expect(schema.fields.map((f) => f.path)).toEqual(["title", "text"]);
    // a theme section can then accept it
    const section = setSectionBlocks("<section></section>", ["promo"]);
    expect(sectionBlockTypes(section)).toContain("promo");
  });
});
