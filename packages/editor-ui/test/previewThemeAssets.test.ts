import { describe, expect, it } from "vitest";
import type { ProjectData } from "../src/api/types.js";
import {
  renderHomeThumbnail,
  renderPreview,
} from "../src/preview/render.js";
import type { EditorState } from "../src/state/editorState.js";

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

describe("preview auto-linked CSS/JS inlining", () => {
  function stateOf(p: ProjectData): EditorState {
    return {
      settings: p.settings,
      content: p.content,
      contentTypes: p.contentTypes,
      menus: p.menus,
    };
  }

  it("inlines extra CSS as <style> and theme JS as <script>, not style.css", () => {
    const p = projectWith({});
    p.theme.assets = [
      "assets/style.css",
      "assets/extra.css",
      "assets/app.js",
      "assets/_draft.css",
    ];
    p.themeTextAssets = {
      "assets/style.css": ".x{}",
      "assets/extra.css": ".extra{color:red}",
      "assets/app.js": "document.title='hi'",
      "assets/_draft.css": ".draft{}",
    };
    const html = renderPreview(p, stateOf(p), { kind: "page", id: "index" });
    // extra stylesheet inlined as its own <style>, tagged with its path
    expect(html).toContain('data-pcms-asset="assets/extra.css"');
    expect(html).toContain(".extra{color:red}");
    // theme JS runs (trusted own script)
    expect(html).toContain("document.title='hi'");
    // style.css is carried by previewCss, never re-inlined as an asset <style>
    expect(html).not.toContain('data-pcms-asset="assets/style.css"');
    // _-prefixed drafts are not auto-linked
    expect(html).not.toContain(".draft{}");
  });

  it("strips scripts embedded in section HTML (untrusted)", () => {
    const p = projectWith({});
    p.theme.templates = {
      ...p.theme.templates,
      index: '<section><script>alert(1)</script><p>x</p></section>',
    };
    const html = renderPreview(p, stateOf(p), { kind: "page", id: "index" });
    expect(html).not.toContain("alert(1)");
  });
});
