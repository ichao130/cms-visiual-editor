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

  it("reorders sections per the operator order", () => {
    const scope = indexScope();
    scope.page = { ...scope.page, sectionOrder: ["menu", "hero", "news"] };
    const out = renderTemplate(theme.templates.index as string, scope);
    const menuAt = out.indexOf('class="menu-list"');
    const heroAt = out.indexOf('class="hero"');
    const newsAt = out.indexOf('class="news"');
    expect(menuAt).toBeLessThan(heroAt);
    expect(heroAt).toBeLessThan(newsAt);
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

describe("image field alt text", () => {
  function imageScope(media?: RenderScope["media"]): RenderScope {
    return {
      site: sampleSite(),
      theme: theme.config,
      page: { fields: { "hero.image": "media/photo.webp" } },
      menus: {},
      collections: {},
      media,
    };
  }
  const tmpl = '<img data-field="hero.image" alt="">';
  const withAlt = { "media/photo.webp": { id: "photo", fileName: "photo.webp", path: "media/photo.webp", alt: "店内のテラス席" } };

  it("fills alt from the media record when the theme img has none", () => {
    const out = renderTemplate(tmpl, imageScope(withAlt));
    expect(out).toContain('src="media/photo.webp"');
    expect(out).toContain('alt="店内のテラス席"');
  });

  it("keeps an alt the theme already set", () => {
    const keep = '<img data-field="hero.image" alt="ロゴ">';
    const out = renderTemplate(keep, imageScope(withAlt));
    expect(out).toContain('alt="ロゴ"');
    expect(out).not.toContain("店内のテラス席");
  });

  it("does not fill alt when the media record has none", () => {
    const out = renderTemplate(tmpl, imageScope({ "media/photo.webp": { id: "photo", fileName: "photo.webp", path: "media/photo.webp" } }));
    expect(out).toContain('src="media/photo.webp"');
    expect(out).not.toMatch(/alt="[^"]/);
  });

  it("does not fill alt when no media map is provided", () => {
    const out = renderTemplate(tmpl, imageScope());
    expect(out).toContain('src="media/photo.webp"');
    expect(out).not.toMatch(/alt="[^"]/);
  });
});
