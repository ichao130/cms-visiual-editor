import { describe, expect, it } from "vitest";
import type { SiteInput } from "../src/index.js";
import { generateSite, renderComposedPage } from "../src/index.js";

const sections = {
  header: '<div class="hdr"><a data-field="site.name">Site</a></div>',
  footer: '<div class="ftr"><small data-field="site.name">Site</small></div>',
  hero: '<section><h1 data-field="heading">H</h1></section>',
};

// A layout that opts into header/footer regions via named slots.
const layoutWithSlots =
  '<html><head><title data-field="site.name"></title></head><body>' +
  '<header data-slot="header"></header>' +
  '<main data-slot="content"></main>' +
  '<footer data-slot="footer"></footer>' +
  "</body></html>";

// A layout with its own fixed header, no region slots.
const layoutFixed =
  '<html><head></head><body>' +
  '<header class="fixed-head">固定ヘッダー</header>' +
  '<main data-slot="content"></main>' +
  "</body></html>";

function baseInput(layout: string, regions?: SiteInput["settings"]["regions"]): SiteInput {
  return {
    site: { name: "店", baseUrl: "https://ex.test" },
    settings: {
      regions,
      pages: {
        index: { instances: [{ id: "h1", type: "hero", fields: { heading: "ようこそ" } }] },
        about: { template: "page" },
      },
    },
    contentTypes: [],
    content: [],
    theme: {
      config: {},
      layout,
      templates: { page: "<main><h1>About</h1></main>" },
      sections,
    },
  };
}

describe("site-wide header/footer regions", () => {
  it("composes regions into the layout slots on every page", () => {
    const regions = {
      header: [{ id: "hd1", type: "header" }],
      footer: [{ id: "ft1", type: "footer" }],
    };
    const { files } = generateSite(baseInput(layoutWithSlots, regions));
    for (const path of ["index.html", "about/index.html"]) {
      const html = files[path]!;
      expect(html, path).toContain('class="hdr"');
      expect(html, path).toContain('class="ftr"');
      // region content binds the layout-level data-field (site.name)
      expect(html, path).toContain(">店<");
    }
  });

  it("keeps the layout's own header when the theme has no region slots", () => {
    const regions = { header: [{ id: "hd1", type: "header" }] };
    const { files } = generateSite(baseInput(layoutFixed, regions));
    const home = files["index.html"]!;
    expect(home).toContain("固定ヘッダー"); // fallback: fixed header untouched
    expect(home).not.toContain('class="hdr"'); // region not injected (no slot)
  });

  it("leaves region slots empty with no markers in published output", () => {
    // Region present but empty → no sections, and no editor insert markers.
    const { files } = generateSite(baseInput(layoutWithSlots, { header: [] }));
    const home = files["index.html"]!;
    expect(home).not.toContain("pcms-insert");
    expect(home).not.toContain('class="hdr"');
  });

  it("marks region sections editable in preview mode", () => {
    const html = renderComposedPage(
      [{ id: "h1", type: "hero", fields: { heading: "本文" } }],
      sections,
      { site: { name: "店", baseUrl: "https://ex.test" }, theme: {}, menus: {}, collections: {} },
      {
        layout: layoutWithSlots,
        markEditable: true,
        regions: { header: [{ id: "hd1", type: "header" }], footer: [] },
        sections,
      },
    );
    // header region: selectable section + region wrapper + insert markers
    expect(html).toContain('data-pcms-region="header"');
    expect(html).toContain('data-pcms-section="hd1"');
    expect(html).toContain("pcms-insert");
    // empty footer region in the editor shows the add hint + a marker
    expect(html).toContain('data-pcms-region="footer"');
    expect(html).toContain("フッターにはセクションがありません");
    // body is wrapped as its own region
    expect(html).toContain('data-pcms-region="body"');
  });
});
