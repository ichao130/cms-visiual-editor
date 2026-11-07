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

  const sized = {
    "media/photo.webp": {
      id: "photo",
      fileName: "photo.webp",
      path: "media/photo.webp",
      width: 800,
      height: 600,
    },
  };

  it("adds width/height from the media record and lazy/async hints", () => {
    const out = renderTemplate(tmpl, imageScope(sized));
    expect(out).toContain('width="800"');
    expect(out).toContain('height="600"');
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
  });

  it("keeps the theme's own width/height and loading attributes", () => {
    const keep = '<img data-field="hero.image" width="200" height="100" loading="eager">';
    const out = renderTemplate(keep, imageScope(sized));
    expect(out).toContain('width="200"');
    expect(out).toContain('height="100"');
    expect(out).not.toContain('width="800"');
    expect(out).toContain('loading="eager"');
    expect(out).not.toContain('loading="lazy"');
  });

  it("still adds lazy/async when the media record has no dimensions", () => {
    const out = renderTemplate(tmpl, imageScope(withAlt));
    expect(out).not.toMatch(/width="/);
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
  });
});

describe("gallery field", () => {
  function galleryScope(value: unknown, media?: RenderScope["media"]): RenderScope {
    return {
      site: sampleSite(),
      theme: theme.config,
      page: { fields: { "g.photos": value as never } },
      menus: {},
      collections: {},
      media,
    };
  }
  const tmpl = '<div class="gallery" data-field="g.photos" data-type="gallery"></div>';
  const media = {
    "media/a.webp": { id: "a", fileName: "a.webp", path: "media/a.webp", width: 800, height: 600, alt: "写真A" },
  };

  it("renders one <img> per image with alt/size from the media record", () => {
    const out = renderTemplate(tmpl, galleryScope(["media/a.webp", "media/b.webp"], media));
    expect((out.match(/<img /g) ?? []).length).toBe(2);
    expect(out).toContain('src="media/a.webp"');
    expect(out).toContain('alt="写真A"');
    expect(out).toContain('width="800"');
    expect(out).toContain('src="media/b.webp"');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toMatch(/data-(field|type)=/);
  });

  it("accepts a comma-separated string value", () => {
    const out = renderTemplate(tmpl, galleryScope("media/a.webp, media/b.webp"));
    expect((out.match(/<img /g) ?? []).length).toBe(2);
  });

  it("renders nothing inside the container when empty", () => {
    const out = renderTemplate(tmpl, galleryScope(""));
    expect(out).toContain('class="gallery"');
    expect(out).not.toContain("<img");
  });
});

describe("nested menus", () => {
  function menuScope(menu: RenderScope["menus"]["x"]): RenderScope {
    return {
      site: sampleSite(),
      theme: theme.config,
      page: {},
      menus: { main: menu },
      collections: {},
    };
  }
  const nested = [
    { label: "ホーム", url: "/" },
    {
      label: "店舗",
      url: "/shops/",
      children: [
        { label: "渋谷店", url: "/shops/shibuya/" },
        { label: "新宿店", url: "/shops/shinjuku/" },
      ],
    },
  ];

  it("renders a submenu when the loop element is an <li>", () => {
    const li =
      '<ul class="nav"><li data-loop="main"><a data-field="item.url" href="#"><span data-field="item.label">x</span></a></li></ul>';
    const out = renderTemplate(li, menuScope(nested));
    expect(out).toContain("ホーム");
    expect(out).toContain('class="pcms-submenu"');
    expect(out).toContain("渋谷店");
    expect(out).toContain('href="/shops/shinjuku/"');
    // one submenu, for the 店舗 item only
    expect((out.match(/pcms-submenu/g) ?? []).length).toBe(1);
  });

  it("keeps a flat <a data-loop> menu flat (no submenu)", () => {
    const flat = '<nav><a data-loop="main" data-field="item.url" href="#"><span data-field="item.label">x</span></a></nav>';
    const out = renderTemplate(flat, menuScope(nested));
    expect(out).toContain("店舗");
    expect(out).not.toContain("pcms-submenu");
    expect(out).not.toContain("渋谷店");
  });
});
