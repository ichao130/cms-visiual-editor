import { describe, expect, it } from "vitest";
import type { ProjectData } from "../src/api/types.js";
import { renderHomeThumbnail } from "../src/preview/render.js";

/**
 * The sandboxed preview iframe can't load theme `assets/…` files, so binary
 * asset references (CSS backgrounds and <img>) must be inlined as data URLs.
 */
function projectWith(themeAssets: Record<string, string>): ProjectData {
  return {
    site: { name: "T", baseUrl: "https://e.test" },
    settings: { pages: { index: {} } } as ProjectData["settings"],
    theme: {
      config: {},
      layout: '<html><head></head><body><main data-slot="content"></main></body></html>',
      templates: {
        index:
          '<section class="hero" style="background-image:url(bg.png)">' +
          '<img src="assets/logo.png" alt=""></section>',
        page: "<main></main>",
      },
      sections: {},
      blocks: {},
      assets: ["assets/bg.png", "assets/logo.png"],
    },
    content: [],
    menus: {},
    contentTypes: [],
    taxonomies: [],
    previewCss: ".hero{min-height:200px;background:url(bg.png) center/cover}",
    themeAssets,
  };
}

describe("preview theme-asset inlining", () => {
  it("inlines CSS url(name) backgrounds and <img assets/…> to data URLs", () => {
    const html = renderHomeThumbnail(
      projectWith({
        "assets/bg.png": "data:image/png;base64,QkdQTkc=",
        "assets/logo.png": "data:image/png;base64,TE9HTw==",
      }),
    );
    // CSS stylesheet-relative url(bg.png) → the asset's data URL
    expect(html).toContain("url(data:image/png;base64,QkdQTkc=)");
    expect(html).not.toContain("url(bg.png)");
    // <img src="assets/logo.png"> → data URL
    expect(html).toContain('src="data:image/png;base64,TE9HTw=="');
    expect(html).not.toContain('"assets/logo.png"');
  });

  it("leaves markup untouched when there are no theme assets", () => {
    const html = renderHomeThumbnail(projectWith({}));
    expect(html).toContain("url(bg.png)");
    expect(html).toContain('src="assets/logo.png"');
  });
});
