import { describe, expect, it } from "vitest";
import type { ContentItem, ContentTypeDef } from "@pcms/shared";
import { summarizeContent } from "../src/screens/site/SiteInfoView.js";

const types: ContentTypeDef[] = [
  { name: "post", label: "お知らせ", fields: [] },
  { name: "staff", label: "スタッフ", fields: [] },
];

function item(type: string, slug: string, status?: "draft" | "published"): ContentItem {
  return { type, slug, fields: {}, body: "", ...(status ? { status } : {}) };
}

describe("summarizeContent", () => {
  it("counts live items per type and totals drafts", () => {
    const content = [
      item("post", "a"),
      item("post", "b"),
      item("post", "c", "draft"),
      item("staff", "d"),
    ];
    const s = summarizeContent(content, types);
    expect(s.types).toEqual([
      { name: "post", label: "お知らせ", count: 2 },
      { name: "staff", label: "スタッフ", count: 1 },
    ]);
    expect(s.drafts).toBe(1);
  });

  it("lists a defined type with zero live items", () => {
    const s = summarizeContent([item("post", "a")], types);
    expect(s.types.find((t) => t.name === "staff")).toEqual({
      name: "staff",
      label: "スタッフ",
      count: 0,
    });
  });

  it("appends an ad-hoc type not in the definitions, labelled by its name", () => {
    const s = summarizeContent([item("page", "x")], types);
    expect(s.types.at(-1)).toEqual({ name: "page", label: "page", count: 1 });
  });

  it("treats an absent status as live", () => {
    expect(summarizeContent([item("post", "a")], types).drafts).toBe(0);
  });
});
