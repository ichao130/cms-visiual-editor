import { describe, expect, it } from "vitest";
import {
  duplicateContent,
  removeContentMany,
  setContentStatusMany,
  uniqueSlug,
  type EditorState,
} from "../src/state/editorState.js";

function state(): EditorState {
  return {
    site: { name: "Test" },
    settings: { pages: {} },
    content: [
      {
        type: "post",
        slug: "open",
        fields: { title: "開店しました", category: ["お知らせ"] },
        body: "<p>本文</p>",
      },
      { type: "post", slug: "hours", fields: { title: "営業時間" }, body: "" },
    ],
    contentTypes: [],
    menus: {},
    taxonomies: [],
  };
}

describe("uniqueSlug", () => {
  it("returns the base when free and suffixes when taken", () => {
    const s = state();
    expect(uniqueSlug(s, "post", "news")).toBe("news");
    expect(uniqueSlug(s, "post", "open")).toBe("open-2");
  });
});

describe("duplicateContent", () => {
  it("copies fields and body under a new slug, right after the original", () => {
    const { state: next, slug } = duplicateContent(state(), "post", "open", "（コピー）");
    expect(slug).toBe("open-copy");

    const copy = next.content.find((i) => i.slug === "open-copy");
    expect(copy).toBeDefined();
    expect(copy?.fields.title).toBe("開店しました（コピー）");
    expect(copy?.fields.category).toEqual(["お知らせ"]);
    expect(copy?.body).toBe("<p>本文</p>");

    // Inserted immediately after "open", before "hours".
    expect(next.content.map((i) => i.slug)).toEqual(["open", "open-copy", "hours"]);
  });

  it("makes the copy slug unique when a -copy already exists", () => {
    const s = state();
    s.content.push({ type: "post", slug: "open-copy", fields: { title: "x" }, body: "" });
    const { slug } = duplicateContent(s, "post", "open", "（コピー）");
    expect(slug).toBe("open-copy-2");
  });

  it("does not mutate the original item's fields", () => {
    const s = state();
    const { state: next } = duplicateContent(s, "post", "open", "（コピー）");
    const original = next.content.find((i) => i.slug === "open");
    expect(original?.fields.title).toBe("開店しました");
  });

  it("returns the state unchanged when the item is missing", () => {
    const s = state();
    const { state: next, slug } = duplicateContent(s, "post", "ghost", "（コピー）");
    expect(next).toBe(s);
    expect(slug).toBe("ghost");
  });
});

describe("setContentStatusMany", () => {
  it("sets the status of only the referenced items", () => {
    const next = setContentStatusMany(
      state(),
      [{ type: "post", slug: "open" }, { type: "post", slug: "hours" }],
      "draft",
    );
    expect(next.content.find((i) => i.slug === "open")?.status).toBe("draft");
    expect(next.content.find((i) => i.slug === "hours")?.status).toBe("draft");
  });

  it("leaves unreferenced items untouched", () => {
    const next = setContentStatusMany(state(), [{ type: "post", slug: "open" }], "draft");
    expect(next.content.find((i) => i.slug === "hours")?.status).toBeUndefined();
  });
});

describe("removeContentMany", () => {
  it("removes every referenced item at once", () => {
    const next = removeContentMany(state(), [
      { type: "post", slug: "open" },
      { type: "post", slug: "hours" },
    ]);
    expect(next.content).toEqual([]);
  });

  it("keeps items that are not referenced", () => {
    const next = removeContentMany(state(), [{ type: "post", slug: "open" }]);
    expect(next.content.map((i) => i.slug)).toEqual(["hours"]);
  });
});
