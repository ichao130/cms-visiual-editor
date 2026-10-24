import { describe, expect, it } from "vitest";
import { parseTemplate } from "../src/index.js";
import { sampleTheme } from "./fixtures.js";

describe("parseTemplate", () => {
  const schema = parseTemplate("index", sampleTheme().templates.index as string);

  it("finds every section", () => {
    expect(schema.sections.map((s) => s.id)).toEqual(["hero", "news", "menu"]);
  });

  it("detects a section's editable fields with labels and types", () => {
    const hero = schema.sections.find((s) => s.id === "hero")!;
    expect(hero.fields.map((f) => f.path)).toEqual([
      "hero.heading",
      "hero.lead",
      "hero.cta_url",
      "hero.cta_label",
    ]);
    const cta = hero.fields.find((f) => f.path === "hero.cta_url")!;
    expect(cta.type).toBe("link");
    expect(cta.label).toBe("ボタンのリンク");
  });

  it("describes a loop and does not leak its inner fields", () => {
    const news = schema.sections.find((s) => s.id === "news")!;
    expect(news.loops).toEqual([{ source: "posts", limit: 3 }]);
    expect(news.fields.map((f) => f.path)).toEqual(["news.title"]);
  });

  it("describes an operator repeat and its fields", () => {
    const menu = schema.sections.find((s) => s.id === "menu")!;
    expect(menu.repeats).toHaveLength(1);
    expect(menu.repeats[0]!.name).toBe("items");
    expect(menu.repeats[0]!.fields.map((f) => f.path)).toEqual([
      "name",
      "price",
      "note",
    ]);
  });
});
