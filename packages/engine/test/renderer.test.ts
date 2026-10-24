import { describe, expect, it } from "vitest";
import type { ContentItem } from "@pcms/shared";
import { renderTemplate, type RenderScope } from "../src/index.js";
import {
  sampleMenus,
  sampleSettings,
  sampleSite,
  sampleTheme,
} from "./fixtures.js";

const theme = sampleTheme();

function indexScope(): RenderScope {
  const posts: ContentItem[] = [
    { type: "post", slug: "a", fields: { title: "記事A", date: "2026-02-10", url: "/post/a/" }, body: "" },
    { type: "post", slug: "b", fields: { title: "記事B", date: "2026-02-01", url: "/post/b/" }, body: "" },
  ];
  return {
    site: sampleSite(),
    theme: theme.config,
    page: sampleSettings().pages.index!,
    menus: sampleMenus(),
    collections: { posts },
  };
}

describe("renderTemplate", () => {
  const html = renderTemplate(theme.templates.index as string, indexScope());

  it("binds field values over theme defaults", () => {
    expect(html).toContain("朝の一杯を、ていねいに。");
    expect(html).not.toContain("こだわりの一杯を");
  });

  it("expands a loop to real items with resolved links", () => {
    expect(html).toContain("記事A");
    expect(html).toContain("記事B");
    expect(html).toContain('href="/post/a/"');
  });

  it("expands an operator repeat", () => {
    expect(html).toContain("ブレンド");
    expect(html).toContain("カフェラテ");
    expect(html).toContain("480円");
  });

  it("drops data-if elements when the value is empty", () => {
    // The ラテ row has no `note`, so its note paragraph must be gone,
    // while the ブレンド row keeps its note.
    expect(html).toContain("やさしい口当たり。");
    expect((html.match(/class="note"/g) ?? []).length).toBe(1);
  });

  it("strips all editor-only data-* attributes", () => {
    expect(html).not.toMatch(/data-(section|field|type|label|loop|limit|repeat|if|slot)=/);
  });

  it("drops a hidden section", () => {
    const scope = indexScope();
    scope.page = {
      ...scope.page,
      sections: [...(scope.page.sections ?? []), { id: "news", hidden: true }],
    };
    const hidden = renderTemplate(theme.templates.index as string, scope);
    expect(hidden).not.toContain("新着情報");
  });

  it("injects the template into the layout slot", () => {
    const withLayout = renderTemplate(theme.templates.index as string, indexScope(), {
      layout: theme.layout,
    });
    expect(withLayout).toContain("<!doctype html>");
    expect(withLayout).toContain("朝の一杯を、ていねいに。");
    expect(withLayout).toContain("テスト珈琲店"); // site.name bound in header
  });
});
